import type { FastifyInstance } from 'fastify';
import { nanoid } from 'nanoid';
import { db, nextSortIndex } from '../db/index.ts';
import { processImage } from '../services/imagePipeline.ts';
import { deleteImageStorage } from '../services/cleanup.ts';
import {
  displayUrl,
  headObject,
  keyFromUrl,
  publicUrl,
  putBufferDetailed,
  s3Config,
  s3Enabled,
} from '../services/s3.ts';
import type { ImageMeta, Paginated, UploadFailure, UploadResponse } from '../../../shared/types.ts';

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200; // guards against a client asking for an unbounded page

// Bounds how many images are processed (sharp + S3 upload) at once per upload
// request. Reading each multipart part's buffer must stay sequential (busboy
// demuxes one HTTP body stream in order), but the CPU/network-heavy work after
// that — sharp re-encode + S3 PutObject — can safely overlap. Keeping this small
// (default 8) bounds peak memory for 4k-5k image batches and avoids S3 throttling.
const MAX_CONCURRENT_UPLOADS = Math.max(1, Number(process.env.MAX_CONCURRENT_UPLOADS ?? 8));

class Semaphore {
  private available: number;
  private waiters: Array<() => void> = [];
  constructor(max: number) { this.available = max; }
  async acquire(): Promise<void> {
    if (this.available > 0) { this.available--; return; }
    await new Promise<void>((resolve) => this.waiters.push(resolve));
  }
  release(): void {
    const next = this.waiters.shift();
    if (next) next();
    else this.available++;
  }
}

function rowToStoredMeta(r: any): ImageMeta {
  return {
    id: r.id,
    sessionId: r.session_id,
    originalUrl: r.original_url,
    mobileUrl: r.mobile_url,
    thumbUrl: r.thumb_url,
    width: r.width,
    height: r.height,
    bytes: r.bytes,
    sortIndex: r.sort_index,
    uploadDate: r.upload_date,
    mimeType: r.mime_type,
  };
}

async function rowToMeta(r: any): Promise<ImageMeta> {
  const meta = rowToStoredMeta(r);
  if (r.storage_provider !== 's3') return meta;
  const [originalUrl, mobileUrl, thumbUrl] = await Promise.all([
    displayUrl(meta.originalUrl, r.storage_provider),
    displayUrl(meta.mobileUrl, r.storage_provider),
    displayUrl(meta.thumbUrl, r.storage_provider),
  ]);
  return { ...meta, originalUrl, mobileUrl, thumbUrl };
}

export default async function imageRoutes(app: FastifyInstance) {
  const insert = db.prepare(`
    INSERT INTO images (
      id, session_id, original_url, mobile_url, thumb_url, width, height, bytes, sort_index,
      storage_provider, s3_key_prefix, mime_type
    )
    VALUES (
      @id, @sessionId, @originalUrl, @mobileUrl, @thumbUrl, @width, @height, @bytes, @sortIndex,
      @storageProvider, @s3KeyPrefix, @mimeType
    )
  `);

  // Paginated image list — never returns the full catalog. A project with 5k-10k
  // images would otherwise mean one multi-MB response and a multi-second cold start;
  // the client now fetches one page (default 50) at a time as the user browses.
  app.get('/api/images', async (req): Promise<Paginated<ImageMeta>> => {
    const { sessionId, page, limit } = req.query as {
      sessionId?: string; page?: string; limit?: string;
    };
    if (!sessionId) return { items: [], total: 0, page: 1, totalPages: 0 };

    const pageNum = Math.max(1, parseInt(page ?? '1', 10) || 1);
    const limitNum = Math.min(MAX_PAGE_SIZE, Math.max(1, parseInt(limit ?? String(DEFAULT_PAGE_SIZE), 10) || DEFAULT_PAGE_SIZE));
    const offset = (pageNum - 1) * limitNum;

    const { n: total } = db.prepare(
      'SELECT COUNT(*) AS n FROM images WHERE session_id = ?'
    ).get(sessionId) as { n: number };

    const rows = db.prepare(
      'SELECT * FROM images WHERE session_id = ? ORDER BY sort_index ASC LIMIT ? OFFSET ?'
    ).all(sessionId, limitNum, offset);

    return {
      items: await Promise.all(rows.map(rowToMeta)),
      total,
      page: pageNum,
      totalPages: Math.ceil(total / limitNum),
    };
  });

  // Resolves an image's 0-based position within its session without downloading the
  // catalog around it. Used to resume a session at the last-viewed image: the client
  // only needs to know *which page* to open, not the whole image list.
  app.get('/api/images/:id/position', async (req, reply) => {
    const { id } = req.params as { id: string };
    const row = db.prepare(
      'SELECT session_id, sort_index FROM images WHERE id = ?'
    ).get(id) as { session_id: string; sort_index: number } | undefined;
    if (!row) { reply.status(404).send({ error: 'not found' }); return; }

    const { n: index } = db.prepare(
      'SELECT COUNT(*) AS n FROM images WHERE session_id = ? AND sort_index < ?'
    ).get(row.session_id, row.sort_index) as { n: number };

    return { index, sortIndex: row.sort_index };
  });

  // Bulk upload into a session; sessionId required as query param. Each multipart
  // part's bytes must be read off the request stream in order (busboy constraint),
  // but the sharp + S3 work per file runs concurrently up to MAX_CONCURRENT_UPLOADS,
  // and one file failing (corrupt image, S3 error) doesn't abort the rest.
  app.post('/api/images/upload', async (req, reply) => {
    const { sessionId } = req.query as { sessionId?: string };
    if (!sessionId) { reply.status(400).send({ error: 'sessionId required' }); return; }

    const created: ImageMeta[] = [];
    const failed: UploadFailure[] = [];
    const limiter = new Semaphore(MAX_CONCURRENT_UPLOADS);
    const tasks: Promise<void>[] = [];

    // Reserved synchronously per file, in upload order — computing this inside the
    // concurrent task instead would race (two in-flight images could both read the
    // same "next" sort_index before either had inserted its row).
    let nextIndex = nextSortIndex(sessionId);

    const parts = req.parts();
    for await (const part of parts) {
      if (part.type !== 'file') continue;
      const filename = part.filename ?? 'image';

      await limiter.acquire();
      let buf: Buffer;
      try {
        buf = await part.toBuffer();
      } catch (err) {
        limiter.release();
        failed.push({ filename, error: (err as Error).message });
        continue;
      }

      const imageId = nanoid();
      const sortIndex = nextIndex++;
      const task = processImage(buf, { sessionId, imageId, filename })
        .then((processed) => {
          const meta: ImageMeta = {
            id: imageId,
            sessionId,
            sortIndex,
            uploadDate: new Date().toISOString(),
            ...processed,
          };
          insert.run({
            id: meta.id, sessionId: meta.sessionId,
            originalUrl: meta.originalUrl, mobileUrl: meta.mobileUrl,
            thumbUrl: meta.thumbUrl, width: meta.width, height: meta.height,
            bytes: meta.bytes, sortIndex: meta.sortIndex,
            storageProvider: processed.storageProvider, s3KeyPrefix: processed.s3KeyPrefix,
            mimeType: processed.mimeType,
          });
          db.prepare('INSERT OR IGNORE INTO annotations (image_id) VALUES (?)').run(meta.id);
          created.push(rowToStoredMeta({
            id: meta.id,
            session_id: meta.sessionId,
            original_url: meta.originalUrl,
            mobile_url: meta.mobileUrl,
            thumb_url: meta.thumbUrl,
            width: meta.width,
            height: meta.height,
            bytes: meta.bytes,
            sort_index: meta.sortIndex,
            upload_date: meta.uploadDate,
            mime_type: meta.mimeType,
          }));
        })
        .catch((err) => {
          failed.push({ filename, error: (err as Error).message });
        })
        .finally(() => limiter.release());
      tasks.push(task);
    }
    await Promise.all(tasks);

    created.sort((a, b) => a.sortIndex - b.sortIndex);
    const responseCreated = await Promise.all(created.map((meta) => {
      const row = db.prepare('SELECT * FROM images WHERE id = ?').get(meta.id);
      return rowToMeta(row);
    }));
    reply.send({ created: responseCreated, failed } satisfies UploadResponse);
  });

  app.get('/api/debug/s3-test', async (_req, reply) => {
    const config = s3Config();
    if (!s3Enabled) {
      reply.status(503).send({ ok: false, error: 'S3 is not enabled', config });
      return;
    }

    const key = `uploads/debug/s3-test-${Date.now()}.txt`;
    const body = Buffer.from(`annotator s3 debug ${new Date().toISOString()}\n`, 'utf8');
    const upload = await putBufferDetailed(key, body, 'text/plain; charset=utf-8');
    const generatedUrl = await displayUrl(upload.url, 's3');
    const exists = await headObject(key)
      .then((r) => ({
        ok: true,
        statusCode: r.$metadata.httpStatusCode,
        contentType: r.ContentType,
        contentLength: r.ContentLength,
      }))
      .catch((err) => ({
        ok: false,
        statusCode: err.$metadata?.httpStatusCode,
        error: err.name,
        message: err.message,
      }));

    const getResult = await fetch(generatedUrl)
      .then(async (r) => {
        await r.arrayBuffer();
        return {
          ok: r.ok,
          statusCode: r.status,
          contentType: r.headers.get('content-type'),
        };
      })
      .catch((err) => ({
        ok: false,
        statusCode: null,
        error: err.name,
        message: err.message,
      }));

    const publicGetResult = await fetch(publicUrl(key))
      .then(async (r) => {
        await r.arrayBuffer();
        return {
          ok: r.ok,
          statusCode: r.status,
          contentType: r.headers.get('content-type'),
        };
      })
      .catch((err) => ({
        ok: false,
        statusCode: null,
        error: err.name,
        message: err.message,
      }));

    return {
      ok: exists.ok && getResult.ok,
      config,
      objectKey: key,
      generatedUrl,
      publicUrl: publicUrl(key),
      parsedKeyFromGeneratedUrl: keyFromUrl(upload.url),
      uploadMetadata: upload.uploadMetadata,
      exists,
      get: getResult,
      publicGet: publicGetResult,
    };
  });

  app.delete('/api/images/:id', async (req) => {
    const { id } = req.params as { id: string };
    const row = db.prepare(
      'SELECT storage_provider, s3_key_prefix, original_url, mobile_url, thumb_url FROM images WHERE id = ?'
    ).get(id) as {
      storage_provider: string; s3_key_prefix: string | null;
      original_url: string; mobile_url: string; thumb_url: string;
    } | undefined;

    db.prepare('DELETE FROM images WHERE id = ?').run(id);

    if (row) {
      try {
        await deleteImageStorage({
          storageProvider: row.storage_provider, s3KeyPrefix: row.s3_key_prefix,
          originalUrl: row.original_url, mobileUrl: row.mobile_url, thumbUrl: row.thumb_url,
        });
      } catch (err) {
        req.log.warn({ err, id }, 'failed to clean up image storage');
      }
    }
    return { ok: true };
  });
}
