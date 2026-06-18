// Best-effort storage cleanup invoked from the image/session DELETE routes, after
// the corresponding SQLite rows are gone — keeps S3/local files from being orphaned.
import { unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { UPLOAD_ROOT, PUBLIC_PREFIX } from './storage.ts';
import { deletePrefix, s3Enabled } from './s3.ts';

export interface ImageStorageRow {
  storageProvider: string;
  s3KeyPrefix: string | null;
  originalUrl: string;
  mobileUrl: string;
  thumbUrl: string;
}

function localPathFromUrl(url: string): string | null {
  if (!url.startsWith(`${PUBLIC_PREFIX}/`)) return null;
  return resolve(UPLOAD_ROOT, url.slice(PUBLIC_PREFIX.length + 1));
}

function unlinkSafe(path: string): void {
  try {
    unlinkSync(path);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
}

export async function deleteImageStorage(row: ImageStorageRow): Promise<void> {
  if (row.storageProvider === 's3' && row.s3KeyPrefix && s3Enabled) {
    await deletePrefix(row.s3KeyPrefix);
    return;
  }
  for (const url of [row.originalUrl, row.mobileUrl, row.thumbUrl]) {
    const path = localPathFromUrl(url);
    if (path) unlinkSafe(path);
  }
}

// One call removes every image's variants under a session at once (vs. one
// deletePrefix per image) — sessions are uploaded under uploads/{sessionId}/...,
// so a session-level prefix delete covers all of its S3-backed images.
export async function deleteSessionS3Storage(sessionId: string): Promise<void> {
  if (s3Enabled) await deletePrefix(`uploads/${sessionId}`);
}
