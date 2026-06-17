import sharp from 'sharp';
import { createHash } from 'node:crypto';
import { storage } from './storage.ts';

export interface ProcessedImage {
  originalUrl: string;
  mobileUrl: string;
  thumbUrl: string;
  width: number;   // dims of the MOBILE variant (the one the canvas maps onto)
  height: number;
  bytes: number;   // size of mobile variant
}

const hash = (buf: Buffer) => createHash('sha1').update(buf).digest('hex').slice(0, 16);

export async function processImage(input: Buffer): Promise<ProcessedImage> {
  const base = sharp(input).rotate(); // honor EXIF orientation

  const [original, mobile, thumb] = await Promise.all([
    base.clone().webp({ quality: 90 }).toBuffer(),
    base.clone().resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 80 }).toBuffer(),
    base.clone().resize({ width: 240, height: 240, fit: 'inside' })
      .webp({ quality: 70 }).toBuffer(),
  ]);

  const meta = await sharp(mobile).metadata();

  // content-hashed, immutable keys
  const [oUrl, mUrl, tUrl] = await Promise.all([
    storage.put(`${hash(original)}-o.webp`, original),
    storage.put(`${hash(mobile)}-m.webp`, mobile),
    storage.put(`${hash(thumb)}-t.webp`, thumb),
  ]);

  return {
    originalUrl: oUrl,
    mobileUrl: mUrl,
    thumbUrl: tUrl,
    width: meta.width ?? 0,
    height: meta.height ?? 0,
    bytes: mobile.byteLength,
  };
}
