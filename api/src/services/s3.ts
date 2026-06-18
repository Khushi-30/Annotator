// Backend-only S3 service (AWS SDK v3). Never import this from web/ — credentials
// must stay server-side. Falls back to disabled (s3Enabled = false) when env vars
// are missing, so local dev without AWS creds still works via the local storage
// adapter in storage.ts.
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const REGION = process.env.AWS_REGION;
const BUCKET = process.env.S3_BUCKET_NAME;
const ACCESS_KEY_ID = process.env.AWS_ACCESS_KEY_ID;
const SECRET_ACCESS_KEY = process.env.AWS_SECRET_ACCESS_KEY;
const PUBLIC_BASE_URL = process.env.S3_PUBLIC_BASE_URL;
const SIGNED_URLS = process.env.S3_SIGNED_URLS !== 'false';
const SIGNED_URL_EXPIRES_SECONDS = Math.min(
  604800,
  Math.max(60, Number(process.env.S3_SIGNED_URL_EXPIRES_SECONDS ?? 604800)),
);

export const s3Enabled = Boolean(REGION && BUCKET && ACCESS_KEY_ID && SECRET_ACCESS_KEY);

let client: S3Client | undefined;
function getClient(): S3Client {
  if (!client) {
    client = new S3Client({
      region: REGION,
      credentials: { accessKeyId: ACCESS_KEY_ID!, secretAccessKey: SECRET_ACCESS_KEY! },
    });
  }
  return client;
}

// Virtual-hosted-style URL, built from bucket+region only when no CDN/base URL is
// configured. Requires the bucket to allow public reads (see README note) — switch
// to signed URLs (see signedGetUrl below) if the bucket must stay private.
export function publicUrl(key: string): string {
  if (PUBLIC_BASE_URL) return `${PUBLIC_BASE_URL.replace(/\/+$/, '')}/${key}`;
  return `https://${BUCKET}.s3.${REGION}.amazonaws.com/${key}`;
}

export interface S3PutResult {
  key: string;
  url: string;
  uploadMetadata: unknown;
}

export async function putBufferDetailed(
  key: string,
  body: Buffer,
  contentType: string,
): Promise<S3PutResult> {
  const response = await getClient().send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    Body: body,
    ContentType: contentType,
    CacheControl: 'public, max-age=31536000, immutable',
  }));
  const url = publicUrl(key);
  console.info('[s3-upload]', {
    bucket: BUCKET,
    region: REGION,
    key,
    generatedUrl: url,
    uploadMetadata: response.$metadata,
  });
  return { key, url, uploadMetadata: response.$metadata };
}

export async function putBuffer(key: string, body: Buffer, contentType: string): Promise<string> {
  const result = await putBufferDetailed(key, body, contentType);
  return result.url;
}

export function s3Config() {
  return {
    enabled: s3Enabled,
    bucket: BUCKET,
    region: REGION,
    publicBaseUrl: PUBLIC_BASE_URL,
    signedUrls: SIGNED_URLS,
    signedUrlExpiresSeconds: SIGNED_URL_EXPIRES_SECONDS,
  };
}

export function keyFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (PUBLIC_BASE_URL) {
      const base = new URL(PUBLIC_BASE_URL.replace(/\/+$/, ''));
      if (parsed.origin === base.origin && parsed.pathname.startsWith(`${base.pathname.replace(/\/+$/, '')}/`)) {
        return decodeURIComponent(parsed.pathname.slice(base.pathname.replace(/\/+$/, '').length + 1));
      }
    }

    const virtualHosted = `${BUCKET}.s3.${REGION}.amazonaws.com`;
    const usEastLegacy = `${BUCKET}.s3.amazonaws.com`;
    if (parsed.hostname === virtualHosted || (REGION === 'us-east-1' && parsed.hostname === usEastLegacy)) {
      return decodeURIComponent(parsed.pathname.replace(/^\/+/, ''));
    }
  } catch {
    return null;
  }
  return null;
}

export async function signedGetUrl(key: string): Promise<string> {
  return getSignedUrl(
    getClient(),
    new GetObjectCommand({ Bucket: BUCKET, Key: key }),
    { expiresIn: SIGNED_URL_EXPIRES_SECONDS },
  );
}

export async function displayUrl(storedUrl: string, storageProvider?: string): Promise<string> {
  if (storageProvider !== 's3' || !s3Enabled || !SIGNED_URLS) return storedUrl;
  const key = keyFromUrl(storedUrl);
  return key ? signedGetUrl(key) : storedUrl;
}

export async function headObject(key: string) {
  return getClient().send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
}

export async function deleteObject(key: string): Promise<void> {
  await getClient().send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
}

// Deletes every object under a key prefix — used to clean up one image's
// original/mobile/thumb variants, or every image under a whole session, in one call.
export async function deletePrefix(prefix: string): Promise<void> {
  const c = getClient();
  const normalized = prefix.endsWith('/') ? prefix : `${prefix}/`;
  let token: string | undefined;
  do {
    const listed = await c.send(new ListObjectsV2Command({
      Bucket: BUCKET,
      Prefix: normalized,
      ContinuationToken: token,
    }));
    const objects = (listed.Contents ?? [])
      .map((o) => o.Key)
      .filter((k): k is string => Boolean(k))
      .map((Key) => ({ Key }));
    if (objects.length > 0) {
      // DeleteObjectsCommand caps at 1000 keys/call; well above what a single image's
      // 3 variants or a multi-thousand-image session page (max 1000 listed/call) needs
      // per iteration.
      await c.send(new DeleteObjectsCommand({ Bucket: BUCKET, Delete: { Objects: objects } }));
    }
    token = listed.IsTruncated ? listed.NextContinuationToken : undefined;
  } while (token);
}

export function buildKeyPrefix(sessionId: string, imageId: string): string {
  return `uploads/${sessionId}/${imageId}`;
}
