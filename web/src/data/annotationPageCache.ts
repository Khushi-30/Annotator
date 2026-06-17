// Gates network fetches for annotation data to one page/window of images at a time
// (Fix A). Dexie (web/src/data/db.ts) remains the actual hot-path read store for
// per-image annotations — that's unchanged and is what makes opening an image inside
// an already-loaded page instant with zero network requests. This module's only job
// is deciding *when* to pull a page's annotations from the server and seed them into
// Dexie, so a 10k-image project never triggers one all-annotations request.
import { fetchAnnotationsBulk } from './api';
import { seedFromServer } from './annotationsRepo';
import type { ImageMeta } from '../../../shared/types';

const MAX_TRACKED_PAGES = 3; // current + adjacent (prev/next)

// Insertion-ordered set of pages already fetched this session. Bounded via LRU
// eviction so a long browsing session doesn't grow this without limit: once a page
// falls outside the tracked window it's evicted here and will be re-fetched (a cheap,
// small bulk request) if the user navigates back to it. Evicting this tracking set
// does NOT delete anything from Dexie — Dexie is disk-backed IndexedDB, and at this
// annotation density (0-2 strokes/image) keeping already-synced rows there indefinitely
// costs negligible space while preserving offline access to pages already visited.
const loadedPages = new Map<number, true>();

function touch(page: number): void {
  loadedPages.delete(page);
  loadedPages.set(page, true);
  while (loadedPages.size > MAX_TRACKED_PAGES) {
    const oldest = loadedPages.keys().next().value as number;
    loadedPages.delete(oldest);
  }
}

export function isAnnotationPageLoaded(page: number): boolean {
  return loadedPages.has(page);
}

// Fetches + seeds annotations for one page of images. No-op (besides recency bump)
// if the page was already loaded, so callers can call this unconditionally whenever
// the visible/adjacent page set changes.
export async function ensureAnnotationsForPage(page: number, images: ImageMeta[]): Promise<void> {
  if (loadedPages.has(page)) { touch(page); return; }
  if (images.length === 0) { touch(page); return; }
  const grouped = await fetchAnnotationsBulk(images.map((im) => im.id));
  await seedFromServer(Object.values(grouped).flat());
  touch(page);
}

// Used when switching sessions, so stale page bookkeeping from a previous session
// doesn't suppress a needed fetch.
export function resetAnnotationPageCache(): void {
  loadedPages.clear();
}
