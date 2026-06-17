import type {
  AnnotationDTO, AnnotationOffsetResponse, AnnotationsBulkResponse, ImageMeta,
  ImagePositionResponse, Paginated, Session, SyncResponse,
} from '../../../shared/types';

export async function fetchSessions(): Promise<Session[]> {
  const r = await fetch('/api/sessions');
  if (!r.ok) throw new Error('fetchSessions failed');
  return r.json();
}

export async function createSession(title?: string): Promise<Session> {
  const r = await fetch('/api/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title }),
  });
  if (!r.ok) throw new Error('createSession failed');
  return r.json();
}

export async function patchSession(
  id: string,
  data: { title?: string; lastViewedImageId?: string | null },
): Promise<void> {
  await fetch(`/api/sessions/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}

export async function deleteSession(id: string): Promise<void> {
  const r = await fetch(`/api/sessions/${id}`, { method: 'DELETE' });
  if (!r.ok) throw new Error('deleteSession failed');
}

// One page of images (default 50) — never the whole catalog. See WorkspaceView for
// how pages are requested as the user browses.
export async function fetchImages(
  sessionId: string, page = 1, limit = 50,
): Promise<Paginated<ImageMeta>> {
  const r = await fetch(
    `/api/images?sessionId=${encodeURIComponent(sessionId)}&page=${page}&limit=${limit}`
  );
  if (!r.ok) throw new Error('fetchImages failed');
  return r.json();
}

// Resolve an image's position within its session without fetching the catalog
// around it. Used to figure out which page to open on session resume.
export async function fetchImagePosition(imageId: string): Promise<ImagePositionResponse> {
  const r = await fetch(`/api/images/${encodeURIComponent(imageId)}/position`);
  if (!r.ok) throw new Error('fetchImagePosition failed');
  return r.json();
}

// Annotations for exactly the given image ids (one page/window's worth), grouped by
// image id. Replaces the old whole-session fetch.
export async function fetchAnnotationsBulk(imageIds: string[]): Promise<AnnotationsBulkResponse> {
  if (imageIds.length === 0) return {};
  const r = await fetch(`/api/annotations/bulk?imageIds=${imageIds.map(encodeURIComponent).join(',')}`);
  if (!r.ok) throw new Error('fetchAnnotationsBulk failed');
  return r.json();
}

// Server-computed global numbering offset (sum of stroke counts for earlier images),
// excluding any image ids the caller has more current unsynced local data for.
export async function fetchAnnotationOffset(
  sessionId: string, beforeSortIndex: number, excludeImageIds: string[] = [],
): Promise<number> {
  const params = new URLSearchParams({ sessionId, beforeSortIndex: String(beforeSortIndex) });
  if (excludeImageIds.length > 0) params.set('excludeImageIds', excludeImageIds.join(','));
  const r = await fetch(`/api/annotations/offset?${params}`);
  if (!r.ok) throw new Error('fetchAnnotationOffset failed');
  const data: AnnotationOffsetResponse = await r.json();
  return data.offset;
}

export async function uploadImages(files: File[], sessionId: string): Promise<ImageMeta[]> {
  const fd = new FormData();
  files.forEach((f) => fd.append('files', f));
  const r = await fetch(`/api/images/upload?sessionId=${encodeURIComponent(sessionId)}`, {
    method: 'POST',
    body: fd,
  });
  if (!r.ok) throw new Error('upload failed');
  return r.json();
}

export async function syncAnnotations(items: AnnotationDTO[]): Promise<SyncResponse> {
  const r = await fetch('/api/annotations/sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items }),
  });
  if (!r.ok) throw new Error('sync failed');
  return r.json();
}
