import { randomUUID } from 'node:crypto';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { HttpError } from '../middleware/errorHandler.js';

/** Allowed upload types → file extension. No SVG/HTML: they can run scripts when opened. */
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const EXT = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'application/pdf': 'pdf',
  [DOCX]: 'docx',
};

export const ADMIN_TYPES = Object.keys(EXT);
export const CHAT_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf', DOCX];

/** Presigned URLs live this long; the browser uploads right after asking. */
const TTL_SECONDS = 5 * 60;

let cached = { sig: '', client: null };

/** Read R2 settings at call time so the server boots (and tests run) without them. */
function r2() {
  const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY } = process.env;
  if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY) {
    throw new HttpError(503, 'File uploads are not configured');
  }
  const sig = `${R2_ACCOUNT_ID}:${R2_ACCESS_KEY_ID}:${R2_SECRET_ACCESS_KEY}`;
  if (cached.sig !== sig) {
    cached = {
      sig,
      client: new S3Client({
        region: 'auto',
        endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
        credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
        // Newer SDKs add checksum params to presigned PUTs, which browser uploads to R2 can't satisfy.
        requestChecksumCalculation: 'WHEN_REQUIRED',
        responseChecksumValidation: 'WHEN_REQUIRED',
      }),
    };
  }
  return cached.client;
}

/**
 * Presign a browser PUT. The key is made here (never from the client's filename);
 * Content-Type and Content-Length are signed, so the upload must match both.
 * @param {{ bucket: 'public' | 'private', prefix: string, contentType: string, size: number }} opts
 */
export async function presignUpload({ bucket, prefix, contentType, size }) {
  const client = r2();
  const name = bucket === 'public' ? process.env.R2_PUBLIC_BUCKET : process.env.R2_PRIVATE_BUCKET;
  if (!name) throw new HttpError(503, 'File uploads are not configured');

  const key = `${prefix}/${randomUUID()}.${EXT[contentType]}`;
  const uploadUrl = await getSignedUrl(
    client,
    new PutObjectCommand({ Bucket: name, Key: key, ContentType: contentType, ContentLength: size }),
    { expiresIn: TTL_SECONDS, signableHeaders: new Set(['content-type', 'content-length']) }
  );
  const base = (process.env.R2_PUBLIC_URL || '').replace(/\/$/, '');
  return {
    key,
    uploadUrl,
    headers: { 'Content-Type': contentType },
    url: bucket === 'public' ? `${base}/${key}` : null,
  };
}

/** Short-lived download link for a private file, sent as an attachment so it never renders inline. */
export async function presignPrivateRead(key) {
  const client = r2();
  return getSignedUrl(
    client,
    new GetObjectCommand({
      Bucket: process.env.R2_PRIVATE_BUCKET,
      Key: key,
      ResponseContentDisposition: 'attachment',
    }),
    { expiresIn: TTL_SECONDS }
  );
}
