import type { FastifyInstance } from 'fastify';
import { nanoid } from 'nanoid';
import { db, nextSortIndex } from '../db/index.ts';
import { processImage } from '../services/imagePipeline.ts';
import type { ImageMeta, Paginated } from '../../../shared/types.ts';

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200; // guards against a client asking for an unbounded page

function rowToMeta(r: any): ImageMeta {
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
  };
}

export default async function imageRoutes(app: FastifyInstance) {
  const insert = db.prepare(`
    INSERT INTO images (id, session_id, original_url, mobile_url, thumb_url, width, height, bytes, sort_index)
    VALUES (@id, @sessionId, @originalUrl, @mobileUrl, @thumbUrl, @width, @height, @bytes, @sortIndex)
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
      items: rows.map(rowToMeta),
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

  // Bulk upload into a session; sessionId required as query param
  app.post('/api/images/upload', async (req, reply) => {
    const { sessionId } = req.query as { sessionId?: string };
    if (!sessionId) { reply.status(400).send({ error: 'sessionId required' }); return; }

    const created: ImageMeta[] = [];
    const parts = req.parts();
    for await (const part of parts) {
      if (part.type !== 'file') continue;
      const buf = await part.toBuffer();
      const processed = await processImage(buf);
      const meta: ImageMeta = {
        id: nanoid(),
        sessionId,
        sortIndex: nextSortIndex(sessionId),
        uploadDate: new Date().toISOString(),
        ...processed,
      };
      insert.run({
        id: meta.id, sessionId: meta.sessionId,
        originalUrl: meta.originalUrl, mobileUrl: meta.mobileUrl,
        thumbUrl: meta.thumbUrl, width: meta.width, height: meta.height,
        bytes: meta.bytes, sortIndex: meta.sortIndex,
      });
      db.prepare('INSERT OR IGNORE INTO annotations (image_id) VALUES (?)').run(meta.id);
      created.push(meta);
    }
    reply.send(created);
  });

  app.delete('/api/images/:id', async (req) => {
    const { id } = req.params as { id: string };
    db.prepare('DELETE FROM images WHERE id = ?').run(id);
    return { ok: true };
  });
}
