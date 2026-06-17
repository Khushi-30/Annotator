import type { FastifyInstance } from 'fastify';
import { db } from '../db/index.ts';
import type {
  AnnotationDTO, AnnotationOffsetResponse, AnnotationsBulkResponse, SyncRequest, SyncResponse,
} from '../../../shared/types.ts';

function rowToDTO(r: any): AnnotationDTO {
  return {
    imageId: r.image_id,
    drawingData: JSON.parse(r.drawing_data),
    notes: r.notes,
    updatedAt: r.updated_at,
    clientRev: r.client_rev,
  };
}

export default async function annotationRoutes(app: FastifyInstance) {
  // Bulk fetch scoped to one page/window of images (Fix A). Replaces the old
  // "all annotations for the session" cold-start call, which became the dominant
  // payload at scale even though density is low — at 10k images that was still one
  // unbounded response. The client now asks for exactly the image ids it's about to
  // show (one page at a time), so payload size stays ~constant regardless of project size.
  app.get('/api/annotations/bulk', async (req): Promise<AnnotationsBulkResponse> => {
    const { imageIds } = req.query as { imageIds?: string };
    const ids = (imageIds ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    if (ids.length === 0) return {};

    const placeholders = ids.map(() => '?').join(',');
    const rows = db.prepare(
      `SELECT * FROM annotations WHERE image_id IN (${placeholders})`
    ).all(...ids);

    // Grouped by image id, per the requested contract. The schema stores one
    // annotation row per image (drawing_data holds the stroke array inside it), so
    // each entry is a 0-or-1-length array rather than one-row-per-stroke.
    const grouped: AnnotationsBulkResponse = {};
    for (const id of ids) grouped[id] = [];
    for (const r of rows) {
      const dto = rowToDTO(r);
      grouped[dto.imageId] = [dto];
    }
    return grouped;
  });

  // Global annotation numbering offset: sum of stroke counts for every image in the
  // session with a lower sort_index, computed in SQL via the stroke_count column
  // (maintained on every sync) instead of requiring the client to hold every prior
  // image's annotations in memory. excludeImageIds lets the client subtract out
  // images it has unsynced local edits for, so it can add the live local count
  // instead (see web/src/data/annotationsRepo.ts:getAnnotationOffset).
  app.get('/api/annotations/offset', async (req): Promise<AnnotationOffsetResponse> => {
    const { sessionId, beforeSortIndex, excludeImageIds } = req.query as {
      sessionId?: string; beforeSortIndex?: string; excludeImageIds?: string;
    };
    if (!sessionId || beforeSortIndex === undefined) return { offset: 0 };

    const exclude = (excludeImageIds ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    let sql = `
      SELECT COALESCE(SUM(a.stroke_count), 0) AS offset
      FROM images i JOIN annotations a ON a.image_id = i.id
      WHERE i.session_id = ? AND i.sort_index < ?
    `;
    const params: unknown[] = [sessionId, Number(beforeSortIndex)];
    if (exclude.length > 0) {
      sql += ` AND i.id NOT IN (${exclude.map(() => '?').join(',')})`;
      params.push(...exclude);
    }
    const row = db.prepare(sql).get(...(params as never[])) as { offset: number };
    return { offset: row.offset };
  });

  // Batched upsert with last-write-wins by client_rev. Also handles sendBeacon payloads.
  app.post('/api/annotations/sync', async (req): Promise<SyncResponse> => {
    const body = req.body as SyncRequest;
    const accepted: string[] = [];
    const conflicts: string[] = [];

    const get = db.prepare('SELECT client_rev FROM annotations WHERE image_id = ?');
    const upsert = db.prepare(`
      INSERT INTO annotations (image_id, drawing_data, notes, updated_at, client_rev, stroke_count)
      VALUES (@image_id, @drawing_data, @notes, @updated_at, @client_rev, @stroke_count)
      ON CONFLICT(image_id) DO UPDATE SET
        drawing_data = excluded.drawing_data,
        notes        = excluded.notes,
        updated_at   = excluded.updated_at,
        client_rev   = excluded.client_rev,
        stroke_count = excluded.stroke_count
    `);

    const items = body?.items ?? [];
    db.exec('BEGIN');
    try {
      for (const it of items) {
        const existing = get.get(it.imageId) as { client_rev: number } | undefined;
        if (existing && it.clientRev < existing.client_rev) {
          conflicts.push(it.imageId);
          continue;
        }
        upsert.run({
          image_id: it.imageId,
          drawing_data: JSON.stringify(it.drawingData),
          notes: it.notes,
          updated_at: it.updatedAt,
          client_rev: it.clientRev,
          stroke_count: it.drawingData.strokes.length,
        });
        accepted.push(it.imageId);
      }
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
    return { accepted, conflicts };
  });
}
