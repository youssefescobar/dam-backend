import { Conversation } from '../models/Conversation.js';
import { Message } from '../models/Message.js';
import { notifyAdmin } from './push.js';
import { emitToAdminQueue, emitToConversation } from '../sockets/chat.js';
import { logger } from '../utils/logger.js';

const DEFAULTS = {
  claimed: 30 * 60 * 1000,
  needs_human: 2 * 60 * 60 * 1000,
  ai_handling: 24 * 60 * 60 * 1000,
};

function idleMs(status) {
  if (status === 'claimed') {
    const n = Number(process.env.CHAT_CLAIMED_IDLE_MS);
    return Number.isFinite(n) && n > 0 ? n : DEFAULTS.claimed;
  }
  if (status === 'needs_human') {
    const n = Number(process.env.CHAT_NEEDS_HUMAN_IDLE_MS);
    return Number.isFinite(n) && n > 0 ? n : DEFAULTS.needs_human;
  }
  if (status === 'ai_handling') {
    const n = Number(process.env.CHAT_AI_IDLE_MS);
    return Number.isFinite(n) && n > 0 ? n : DEFAULTS.ai_handling;
  }
  return null;
}

/**
 * Close idle conversations. Safe to call from a timer.
 * @returns {Promise<number>} number closed
 */
export async function sweepIdleConversations() {
  const now = Date.now();
  let closed = 0;

  for (const status of ['claimed', 'needs_human', 'ai_handling']) {
    const ms = idleMs(status);
    if (!ms) continue;
    const cutoff = new Date(now - ms);
    const stale = await Conversation.find({
      status,
      lastActivityAt: { $lte: cutoff },
    }).limit(50);

    for (const conversation of stale) {
      try {
        await autoCloseConversation(conversation);
        closed += 1;
      } catch (err) {
        logger.warn(
          { err: err.message, id: conversation._id.toString() },
          'auto-close failed'
        );
      }
    }
  }

  return closed;
}

async function autoCloseConversation(conversation) {
  const assignedAdminId = conversation.assignedAdminId
    ? String(conversation.assignedAdminId)
    : null;
  const conversationId = conversation._id.toString();

  conversation.status = 'closed';
  conversation.lastActivityAt = new Date();
  await conversation.save();

  const notice = await Message.create({
    conversationId: conversation._id,
    sender: 'system',
    text: 'This chat was closed due to inactivity.',
  });

  emitToConversation(conversationId, 'message:new', {
    sender: 'system',
    text: notice.text,
    conversationId,
  });
  emitToAdminQueue('conversation:closed', {
    conversationId,
    reason: 'inactivity',
  });

  if (assignedAdminId) {
    notifyAdmin(assignedAdminId, {
      title: 'Chat auto-closed',
      body: 'A claimed chat closed after inactivity.',
      data: {
        type: 'closed',
        conversationId,
        url: `/inbox?c=${conversationId}`,
      },
    }).catch(() => {});
  }
}

/** @type {ReturnType<typeof setInterval> | null} */
let timer = null;

export function startConversationLifecycleJob() {
  if (process.env.NODE_ENV === 'test') return;
  if (timer) return;
  const every = Number(process.env.CHAT_IDLE_SWEEP_MS) || 60_000;
  timer = setInterval(() => {
    sweepIdleConversations().catch((err) => {
      logger.warn({ err: err.message }, 'idle sweep error');
    });
  }, every);
  if (typeof timer.unref === 'function') timer.unref();
  logger.info({ everyMs: every }, 'Conversation idle sweeper started');
}

export function stopConversationLifecycleJob() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
