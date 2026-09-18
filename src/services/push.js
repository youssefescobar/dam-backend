import webpush from 'web-push';
import { Admin } from '../models/Admin.js';
import { logger } from '../utils/logger.js';

/** @type {((payload: { title: string, body: string, data?: object }) => Promise<void>) | null} */
let pushImpl = null;

export function setPushImplementation(fn) {
  pushImpl = fn;
}

export function initPush() {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT || 'mailto:admin@example.com';

  if (publicKey && privateKey) {
    webpush.setVapidDetails(subject, publicKey, privateKey);
    pushImpl = defaultNotifyAdmins;
    logger.info('Web Push VAPID configured');
  } else {
    logger.info('Web Push not configured (missing VAPID keys)');
  }
}

/** Snapshot for /health */
export function getPushStatus() {
  const vapidConfigured = Boolean(
    process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY
  );
  return {
    vapidConfigured,
    ready: vapidConfigured && typeof pushImpl === 'function',
  };
}

export async function notifyAdmins(payload) {
  if (typeof pushImpl === 'function') {
    return pushImpl(payload);
  }
}

async function defaultNotifyAdmins(payload) {
  const admins = await Admin.find({ 'pushSubscriptions.0': { $exists: true } });
  const body = JSON.stringify({
    title: payload.title,
    body: payload.body,
    data: payload.data || {},
  });

  for (const admin of admins) {
    const remaining = [];
    for (const sub of admin.pushSubscriptions) {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: sub.keys,
          },
          body
        );
        remaining.push(sub);
      } catch (err) {
        const status = err.statusCode || err.status;
        if (status === 404 || status === 410) {
          logger.info({ endpoint: sub.endpoint }, 'Removing expired push subscription');
          // drop subscription
        } else {
          logger.warn({ err: err.message }, 'Push send failed');
          remaining.push(sub);
        }
      }
    }
    if (remaining.length !== admin.pushSubscriptions.length) {
      admin.pushSubscriptions = remaining;
      await admin.save();
    }
  }
}