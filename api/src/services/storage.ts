// Local-disk storage adapter. Implements a tiny interface so it can be swapped
// for Cloudflare R2 / S3 without touching the rest of the app: keep `put` returning
// a public URL and serve those URLs (here via @fastify/static at /files).

import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const UPLOAD_DIR = resolve(process.cwd(), 'data', 'uploads');
mkdirSync(UPLOAD_DIR, { recursive: true });

export const PUBLIC_PREFIX = '/files';

export interface Storage {
  put(key: string, buf: Buffer): Promise<string>; // returns public URL path
}

export const localStorageAdapter: Storage = {
  async put(key, buf) {
    writeFileSync(resolve(UPLOAD_DIR, key), buf);
    return `${PUBLIC_PREFIX}/${key}`;
  },
};

export const UPLOAD_ROOT = UPLOAD_DIR;
export const storage = localStorageAdapter;

/* --- To switch to Cloudflare R2 (S3 API), replace the adapter with:

import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
const s3 = new S3Client({ region: 'auto', endpoint: process.env.R2_ENDPOINT, credentials: {...} });
export const storage: Storage = {
  async put(key, buf) {
    await s3.send(new PutObjectCommand({
      Bucket: process.env.R2_BUCKET, Key: key, Body: buf,
      ContentType: 'image/webp', CacheControl: 'public, max-age=31536000, immutable',
    }));
    return `${process.env.CDN_BASE}/${key}`;
  },
};
--- */
