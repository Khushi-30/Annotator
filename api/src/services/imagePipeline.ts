import sharp from 'sharp';
import { createHash } from 'node:crypto';
import { storage } from './storage.ts';
import { s3Enabled, putBuffer, buildKeyPrefix } from './s3.ts';

export interface ProcessedImage {
  originalUrl: string;
  mobileUrl: string;
  thumbUrl: string;
  width: number;   // dims of the MOBILE variant (the one the canvas maps onto)
  height: number;
  bytes: number;   // size of mobile variant
  storageProvider: 'local' | 's3';
  s3KeyPrefix: string | null; // set when storageProvider === 's3'; variants live under it
  mimeType: string;
}

const hash = (buf: Buffer) => createHash('sha1').update(buf).digest('hex').slice(0, 16);

// Strips path separators and anything outside a safe charset so a filename can be
// used as part of an S3 key without traversal or encoding surprises.
function safeFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? 'image';
  return base.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-100) || 'image';
}

export async function processImage(
  input: Buffer,
  ids: { sessionId: string; imageId: string; filename: string },
): Promise<ProcessedImage> {
  const base = sharp(input).rotate(); // honor EXIF orientation

  const [original, mobile, thumb] = await Promise.all([
    base.clone().webp({ quality: 90 }).toBuffer(),
    base.clone().resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 80 }).toBuffer(),
    base.clone().resize({ width: 240, height: 240, fit: 'inside' })
      .webp({ quality: 70 }).toBuffer(),
  ]);

  const meta = await sharp(mobile).metadata();
  const mimeType = 'image/webp';

  if (s3Enabled) {
    const prefix = buildKeyPrefix(ids.sessionId, ids.imageId);
    const [oUrl, mUrl, tUrl] = await Promise.all([
      putBuffer(`${prefix}/original-${safeFilename(ids.filename)}.webp`, original, mimeType),
      putBuffer(`${prefix}/mobile.webp`, mobile, mimeType),
      putBuffer(`${prefix}/thumb.webp`, thumb, mimeType),
    ]);
    return {
      originalUrl: oUrl, mobileUrl: mUrl, thumbUrl: tUrl,
      width: meta.width ?? 0, height: meta.height ?? 0, bytes: mobile.byteLength,
      storageProvider: 's3', s3KeyPrefix: prefix, mimeType,
    };
  }

  // Local fallback (no S3 env configured) — same content-hashed scheme as before.
  const [oUrl, mUrl, tUrl] = await Promise.all([
    storage.put(`${hash(original)}-o.webp`, original),
    storage.put(`${hash(mobile)}-m.webp`, mobile),
    storage.put(`${hash(thumb)}-t.webp`, thumb),
  ]);

  return {
    originalUrl: oUrl, mobileUrl: mUrl, thumbUrl: tUrl,
    width: meta.width ?? 0, height: meta.height ?? 0, bytes: mobile.byteLength,
    storageProvider: 'local', s3KeyPrefix: null, mimeType,
  };
}
