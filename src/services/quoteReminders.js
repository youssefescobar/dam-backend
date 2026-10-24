import { Quote } from '../models/Quote.js';
import { getCompanySettings } from '../models/Settings.js';
import { notifyAdmins } from './push.js';
import { emitToAdminQueue } from '../sockets/chat.js';
import { logger } from '../utils/logger.js';

const HOUR = 60 * 60 * 1000;
const BATCH = 50;

async function remind(quote, kind, field, body) {
  // Claim the reminder first so two sweeps (or two servers) never send it twice.
  const claimed = await Quote.findOneAndUpdate(
    { _id: quote._id, [field]: null },
    { $set: { [field]: new Date() } },
    { returnDocument: 'after' }
  ).lean();
  if (!claimed) return false;

  const id = claimed._id.toString();
  notifyAdmins({
    title: kind === 'overdue' ? 'Quote waiting too long' : 'Follow up on quote',
    body,
    data: { type: 'quote_reminder', kind, quoteId: id, leadId: claimed.leadId, url: `/quotes?q=${id}` },
  }).catch(() => {});
  emitToAdminQueue('quote:reminder', { kind, quote: claimed });
  return true;
}

/**
 * Send one-off reminders for quotes that are past the reply SLA ("new" too long)
 * or quoted with no decision after `quoteFollowUpDays`. Safe to call from a timer.
 * @returns {Promise<{ overdue: number, followUp: number }>}
 */
export async function sweepQuoteReminders(now = new Date()) {
  const settings = await getCompanySettings();
  const slaHours = settings.quoteSlaHours || 24;
  const followUpDays = settings.quoteFollowUpDays ?? 3;
  let overdue = 0;
  let followUp = 0;

  const late = await Quote.find({
    status: 'new',
    overdueRemindedAt: null,
    createdAt: { $lte: new Date(now.getTime() - slaHours * HOUR) },
  })
    .sort({ createdAt: 1 })
    .limit(BATCH)
    .lean();
  for (const q of late) {
    const body = `${q.leadId || 'Quote'} · ${q.customerName} has waited over ${slaHours}h for a reply`;
    if (await remind(q, 'overdue', 'overdueRemindedAt', body)) overdue += 1;
  }

  if (followUpDays > 0) {
    const quiet = await Quote.find({
      status: 'quoted',
      followUpRemindedAt: null,
      quotedAt: { $ne: null, $lte: new Date(now.getTime() - followUpDays * 24 * HOUR) },
    })
      .sort({ quotedAt: 1 })
      .limit(BATCH)
      .lean();
    for (const q of quiet) {
      const body = `${q.leadId || 'Quote'} · ${q.customerName}: no decision ${followUpDays} days after quoting`;
      if (await remind(q, 'follow_up', 'followUpRemindedAt', body)) followUp += 1;
    }
  }

  return { overdue, followUp };
}

/** @type {ReturnType<typeof setInterval> | null} */
let timer = null;

export function startQuoteReminderJob() {
  if (process.env.NODE_ENV === 'test') return;
  if (timer) return;
  const every = Number(process.env.QUOTE_REMINDER_SWEEP_MS) || 5 * 60_000;
  timer = setInterval(() => {
    sweepQuoteReminders().catch((err) => {
      logger.warn({ err: err.message }, 'quote reminder sweep error');
    });
  }, every);
  if (typeof timer.unref === 'function') timer.unref();
  logger.info({ everyMs: every }, 'Quote reminder sweeper started');
}
