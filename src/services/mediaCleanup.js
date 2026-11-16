import { SiteContent } from '../models/SiteContent.js';
import { FleetBus } from '../models/FleetBus.js';
import { Report } from '../models/Report.js';
import { logger } from '../utils/logger.js';
import { adminKeyOf, deleteFiles, listFiles } from './storage.js';

const DAY = 24 * 60 * 60_000;

/** R2 keys of every admin upload a content item or fleet bus still uses. */
export async function usedAdminKeys() {
  const [posts, buses] = await Promise.all([
    SiteContent.find({}, 'image media').lean(),
    FleetBus.find({}, 'coverImage exteriorImages interiorImages').lean(),
  ]);
  const urls = [
    ...posts.flatMap((d) => [d.image, ...(d.media || [])]),
    ...buses.flatMap((b) => [b.coverImage, ...(b.exteriorImages || []), ...(b.interiorImages || [])]),
  ];
  return new Set(urls.map(adminKeyOf).filter(Boolean));
}

/** Delete these uploaded files from R2 unless another content item or bus still uses them. */
export async function deleteUnusedMedia(urls) {
  const keys = [...new Set(urls.map(adminKeyOf).filter(Boolean))];
  if (!keys.length) return;
  const used = await usedAdminKeys();
  await deleteFiles('public', keys.filter((k) => !used.has(k)));
}

/** Delete files under `prefix` older than `graceMs` that `usedKeys` doesn't list. */
async function sweep(bucket, prefix, usedKeys, now, graceMs) {
  const old = (await listFiles(bucket, prefix)).filter((f) => now - f.lastModified > graceMs);
  if (!old.length) return 0;
  const used = await usedKeys();
  const orphans = old.map((f) => f.key).filter((k) => !used.has(k));
  await deleteFiles(bucket, orphans);
  return orphans.length;
}

/**
 * Remove uploads nothing uses: admin media no post lists (editor closed without saving),
 * and chat files no report keeps (form cancelled after the upload).
 * Files younger than `graceMs` are kept: someone may still be mid-edit or mid-form.
 */
export async function sweepUnusedMedia(now = new Date(), graceMs = DAY) {
  const admin = await sweep('public', 'admin/', usedAdminKeys, now, graceMs);
  const chat = await sweep(
    'private',
    'chat/',
    async () => new Set((await Report.find({ 'attachments.0': { $exists: true } }, 'attachments.key').lean()).flatMap((r) => r.attachments.map((a) => a.key))),
    now,
    graceMs
  );
  return admin + chat;
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
