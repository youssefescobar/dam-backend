import { SiteContent } from '../models/SiteContent.js';
import { logger } from '../utils/logger.js';
import { adminKeyOf, deletePublicFiles, listPublicFiles } from './storage.js';

const DAY = 24 * 60 * 60_000;

const keysOf = (docs) =>
  new Set(docs.flatMap((d) => [d.image, ...(d.media || [])]).map(adminKeyOf).filter(Boolean));

/** Delete these uploaded files from R2 unless another content item still uses them. */
export async function deleteUnusedMedia(urls) {
  const keys = [...new Set(urls.map(adminKeyOf).filter(Boolean))];
  if (!keys.length) return;
  const docs = await SiteContent.find({}, 'image media').lean();
  const used = keysOf(docs);
  await deletePublicFiles(keys.filter((k) => !used.has(k)));
}

/**
 * Remove uploads no content item uses (e.g. the editor was closed without saving).
 * Files younger than `graceMs` are kept: someone may still be editing that post.
 */
export async function sweepUnusedMedia(now = new Date(), graceMs = DAY) {
  const old = (await listPublicFiles('admin/')).filter((f) => now - f.lastModified > graceMs);
  if (!old.length) return 0;
  const used = keysOf(await SiteContent.find({}, 'image media').lean());
  const orphans = old.map((f) => f.key).filter((k) => !used.has(k));
  await deletePublicFiles(orphans);
  return orphans.length;
}

/** @type {ReturnType<typeof setInterval> | null} */
let timer = null;

export function startMediaCleanupJob() {
  if (process.env.NODE_ENV === 'test') return;
  if (timer || !process.env.R2_PUBLIC_BUCKET) return;
  timer = setInterval(() => {
    sweepUnusedMedia()
      .then((n) => n && logger.info({ deleted: n }, 'Removed unused uploads'))
      .catch((err) => logger.warn({ err: err.message }, 'media cleanup sweep error'));
  }, 60 * 60_000);
  if (typeof timer.unref === 'function') timer.unref();
  logger.info('Media cleanup sweeper started');
}
