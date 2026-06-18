import type { FastifyInstance } from 'fastify';
import { nanoid } from 'nanoid';
import { db } from '../db/index.ts';
import { deleteImageStorage, deleteSessionS3Storage } from '../services/cleanup.ts';
import { displayUrl } from '../services/s3.ts';
import type { Session } from '../../../shared/types.ts';

async function rowToSession(r: any): Promise<Session> {
  return {
    id: r.id,
    title: r.title,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    totalImages: r.total_images ?? 0,
    completedImages: r.completed_images ?? 0,
    annotationCount: r.annotation_count ?? 0,
    lastViewedImageId: r.last_viewed_image_id ?? null,
    lastActivityAt: r.last_activity_at,
    previewThumbUrl: r.preview_thumb_url
      ? await displayUrl(r.preview_thumb_url, r.preview_thumb_storage_provider)
      : null,
  };
}

// Aggregate query: counts + first-image thumbnail per session.
const SESSION_QUERY = `
  SELECT
    s.id, s.title, s.created_at, s.updated_at,
    s.last_viewed_image_id, s.last_activity_at,
    COUNT(DISTINCT i.id)                                                      AS total_images,
    COUNT(DISTINCT CASE
      WHEN a.notes != '' OR a.drawing_data != '{"v":1,"strokes":[]}'
      THEN i.id END)                                                          AS completed_images,
    COALESCE(SUM(json_array_length(a.drawing_data, '$.strokes')), 0)         AS annotation_count,
    (SELECT thumb_url FROM images
     WHERE session_id = s.id ORDER BY sort_index LIMIT 1)                    AS preview_thumb_url,
    (SELECT storage_provider FROM images
     WHERE session_id = s.id ORDER BY sort_index LIMIT 1)                    AS preview_thumb_storage_provider
  FROM sessions s
  LEFT JOIN images      i ON i.session_id = s.id
  LEFT JOIN annotations a ON a.image_id   = i.id
  GROUP BY s.id
`;

function formatTitle(isoDate: string): string {
  return new Date(isoDate).toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

export default async function sessionRoutes(app: FastifyInstance) {
  // List all sessions ordered by most recently active
  app.get('/api/sessions', async () => {
    const rows = db.prepare(`${SESSION_QUERY} ORDER BY s.last_activity_at DESC`).all();
    return Promise.all(rows.map(rowToSession));
  });

  // Create a new session; returns the session with zero counts
  app.post('/api/sessions', async (req) => {
    const body = req.body as { title?: string } | undefined;
    const now = new Date().toISOString();
    const id = nanoid();
    const title = body?.title?.trim() || formatTitle(now);
    db.prepare(
      `INSERT INTO sessions (id, title, created_at, updated_at, last_activity_at)
       VALUES (?, ?, ?, ?, ?)`
    ).run(id, title, now, now, now);
    return {
      id, title,
      createdAt: now, updatedAt: now, lastActivityAt: now,
      totalImages: 0, completedImages: 0, annotationCount: 0,
      lastViewedImageId: null, previewThumbUrl: null,
    } satisfies Session;
  });

  // Update lastViewedImageId and/or title; always bumps last_activity_at + updated_at
  app.patch('/api/sessions/:id', async (req) => {
    const { id } = req.params as { id: string };
    const body = req.body as { title?: string; lastViewedImageId?: string | null } | undefined;
    const now = new Date().toISOString();

    if (body?.title !== undefined) {
      db.prepare('UPDATE sessions SET title = ?, updated_at = ? WHERE id = ?')
        .run(body.title.trim(), now, id);
    }
    if (body?.lastViewedImageId !== undefined) {
      db.prepare(
        'UPDATE sessions SET last_viewed_image_id = ?, last_activity_at = ?, updated_at = ? WHERE id = ?'
      ).run(body.lastViewedImageId, now, now, id);
    }
    return { ok: true };
  });

  // Delete a session (cascades to images + annotations via FK). Storage rows are
  // read before the cascade fires; S3-backed images are removed with a single
  // prefix delete (uploads/{sessionId}/...), local-backed legacy images are removed
  // one-by-one since they aren't stored under a per-session folder.
  app.delete('/api/sessions/:id', async (req) => {
    const { id } = req.params as { id: string };
    const rows = db.prepare(
      'SELECT storage_provider, s3_key_prefix, original_url, mobile_url, thumb_url FROM images WHERE session_id = ?'
    ).all(id) as Array<{
      storage_provider: string; s3_key_prefix: string | null;
      original_url: string; mobile_url: string; thumb_url: string;
    }>;

    db.prepare('DELETE FROM sessions WHERE id = ?').run(id);

    try {
      const hasS3Rows = rows.some((r) => r.storage_provider === 's3');
      const localRows = rows.filter((r) => r.storage_provider !== 's3');
      await Promise.all([
        hasS3Rows ? deleteSessionS3Storage(id) : Promise.resolve(),
        ...localRows.map((r) => deleteImageStorage({
          storageProvider: r.storage_provider, s3KeyPrefix: r.s3_key_prefix,
          originalUrl: r.original_url, mobileUrl: r.mobile_url, thumbUrl: r.thumb_url,
        })),
      ]);
    } catch (err) {
      req.log.warn({ err, sessionId: id }, 'failed to clean up session storage');
    }
    return { ok: true };
  });
}
