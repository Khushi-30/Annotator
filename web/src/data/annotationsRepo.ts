// Local-first repository: the app reads/writes HERE on the hot path (IndexedDB),
// never the network. This is what makes load instant and guarantees no lost work.

import { db, type LocalAnnotation } from './db';
import { fetchAnnotationOffset } from './api';
import { emptyDrawing, type AnnotationDTO, type DrawingData } from '../../../shared/types';

let revCounter = Date.now(); // monotonic-ish across the session
const nextRev = () => ++revCounter;

export async function getAnnotation(imageId: string): Promise<LocalAnnotation> {
  const found = await db.annotations.get(imageId);
  if (found) return found;
  const fresh: LocalAnnotation = {
    imageId,
    drawingData: emptyDrawing(),
    notes: '',
    updatedAt: Date.now(),
    // 0, not nextRev(): this is an unsaved placeholder, not a real edit. A live
    // clientRev here would beat the real server revision in seedFromServer's LWW
    // check and permanently shadow server data that arrives a moment later.
    clientRev: 0,
    dirty: 0,
  };
  await db.annotations.put(fresh);
  return fresh;
}

export async function saveDrawing(imageId: string, drawingData: DrawingData): Promise<void> {
  const prev = await getAnnotation(imageId);
  await db.annotations.put({
    ...prev,
    drawingData,
    updatedAt: Date.now(),
    clientRev: nextRev(),
    dirty: 1,
  });
}

export async function saveNotes(imageId: string, notes: string): Promise<void> {
  const prev = await getAnnotation(imageId);
  await db.annotations.put({
    ...prev,
    notes,
    updatedAt: Date.now(),
    clientRev: nextRev(),
    dirty: 1,
  });
}

// Global annotation numbering: strokes are append-only per image (drawn strokes are
// pushed to the end; undo/clear only ever remove from the end), so a stroke's index
// within its image's array IS its creation order. The global number for a stroke is
// "how many strokes exist on earlier images (by sortIndex), plus its own index".
//
// At project scale we can't require every prior image's annotations to be loaded
// locally (that's exactly the unbounded-memory pattern this is meant to avoid), so
// the offset is computed server-side via SQL SUM(stroke_count) (see
// api/src/routes/annotations.ts GET /api/annotations/offset) instead of summing
// local Dexie rows for images that may not even have been fetched yet.
//
// The one piece the server doesn't know about is *unsynced* local edits: an image
// the user just drew on may have more (or fewer) strokes locally than the server's
// last-synced stroke_count. The flusher syncs aggressively, so this set is normally
// 0-1 images. We ask the server to exclude those ids from its sum and add their live
// local counts ourselves, so the result is always exact regardless of sync timing.
export async function getAnnotationOffset(sessionId: string, beforeSortIndex: number): Promise<number> {
  const dirty = await db.annotations.where('dirty').equals(1).toArray();
  if (dirty.length === 0) return fetchAnnotationOffset(sessionId, beforeSortIndex);

  let localSum = 0;
  const excludeImageIds: string[] = [];
  for (const a of dirty) {
    const image = await db.images.get(a.imageId);
    if (!image || image.sessionId !== sessionId || image.sortIndex >= beforeSortIndex) continue;
    excludeImageIds.push(a.imageId);
    localSum += a.drawingData.strokes.length;
  }
  const serverOffset = await fetchAnnotationOffset(sessionId, beforeSortIndex, excludeImageIds);
  return serverOffset + localSum;
}

// Seed local store from server on cold start (only fills gaps / newer server rows).
export async function seedFromServer(remote: AnnotationDTO[]): Promise<void> {
  await db.transaction('rw', db.annotations, async () => {
    for (const r of remote) {
      const local = await db.annotations.get(r.imageId);
      if (!local || (local.dirty === 0 && r.clientRev > local.clientRev)) {
        await db.annotations.put({ ...r, dirty: 0 });
      }
    }
  });
}
