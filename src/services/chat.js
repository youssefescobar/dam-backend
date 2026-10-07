import { Conversation, bumpConversationActivity } from '../models/Conversation.js';
import { Message } from '../models/Message.js';
import { Customer, findOrUpsertCustomer, customerPublic } from '../models/Customer.js';
import { loadFaqEntries } from './faqPrompt.js';
import {
  generateAnswer,
  looksLikeDontKnow,
  looksLikeEscalate,
  isExplicitHumanRequest,
  isImmediateSafetyEscalation,
  classifyChitchat,
} from './llm.js';
import { notifyAdmins, notifyAdmin } from './push.js';
import { countOnlineAdmins, emitToAdminQueue, emitToConversation } from '../sockets/chat.js';
import {
  EXTRA_OPTIONS,
  ALL_TOPIC_OPTIONS,
  MAIN_MENU_OPTIONS,
  REPLIES,
  detectIntent,
  detectLang,
  findChoiceIdByLabel,
  getGuidedNode,
  greetingWelcome,
  guidedAnswerText,
  localizeOptions,
  menuOptions,
  normalizeLang,
  pickText,
  resolveGuidedOptions,
} from '../config/guidedChat.js';
import { getCompanySettings } from '../models/Settings.js';
import { logUnanswered } from '../models/UnansweredQuestion.js';
import { isOpenNow, nextOpeningText } from './officeHours.js';
import { Report } from '../models/Report.js';
import {
  formIntro,
  getForm,
  isFlowCancel,
  isFlowSkip,
  makeRefNumber,
  reportDoneText,
  stepPrompt,
} from '../config/guidedForms.js';

/** After this many unanswered turns in a row, hand over to a person. */
const MAX_UNSURE_STREAK = 3;
/** A stored conversation older than this is not resumed by the website. */
const RESUME_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Start a chat session after collecting identity.
 * @param {{ name: string, email?: string, phone: string, lang?: string }} input
 */
export async function startChatSession(input) {
  const customer = await findOrUpsertCustomer(input);
  const conversation = await Conversation.create({
    customerId: customer._id,
    status: 'ai_handling',
    language: normalizeLang(input.lang),
    lastActivityAt: new Date(),
  });
  return { customer: customerPublic(customer), conversation };
}

const digitsOf = (s) => String(s || '').replace(/\D/g, '');

/**
 * Messages + state for resuming a chat after a page reload.
 * The caller must prove it knows the customer's phone number.
 */
export async function getConversationForResume(conversationId, phone) {
  if (!conversationId || !/^[a-f0-9]{24}$/i.test(String(conversationId))) return null;
  const conversation = await Conversation.findById(conversationId);
  if (!conversation) return null;

  const customer = await Customer.findById(conversation.customerId).lean();
  const given = digitsOf(phone);
  const known = digitsOf(customer?.phone);
  if (!given || !known || given.slice(-9) !== known.slice(-9)) return null;

  const stale = Date.now() - new Date(conversation.lastActivityAt).getTime() > RESUME_WINDOW_MS;
  if (conversation.status === 'closed' || stale) return { resumable: false };

  const rows = await Message.find({ conversationId: conversation._id })
    .sort({ createdAt: -1 })
    .limit(60)
    .lean();
  const lang = normalizeLang(conversation.language);
  const flowActive = Boolean(conversation.flow?.type);
  const human = conversation.status === 'needs_human' || conversation.status === 'claimed';

  return {
    resumable: true,
    conversationId: String(conversation._id),
    status: conversation.status,
    language: lang,
    messages: rows.reverse().map((m) => ({
      id: String(m._id),
      sender: m.sender,
      text: m.text,
      createdAt: m.createdAt,
    })),
    options: human
      ? []
      : flowActive
        ? localizeOptions([EXTRA_OPTIONS.cancel_flow], lang)
        : menuOptions(lang),
  };
}

function resolveChoice(input) {
  const raw = input.choiceId || findChoiceIdByLabel(input.text) || null;
  if (!raw) return null;
  if (getGuidedNode(raw)) return raw;
  // `open_quote` is a link button, but older clients may still post it as a choice.
  if (raw === 'open_quote') return 'quote';
  // Any other unknown id with no typed text → show the menu instead of failing.
  return String(input.text || '').trim() ? null : 'main_menu';
}

/**
 * Process a customer chat message:
 * safety/human triggers → active form → guided menu → keyword intents →
 * greetings → FAQ retrieval + LLM → graceful fallback (offer a person).
 * @param {{
 *   conversationId?: string,
 *   customerName?: string,
 *   customerEmail?: string,
 *   customerPhone?: string,
 *   text?: string,
 *   choiceId?: string,
 *   lang?: string,
 * }} input
 */
export async function handleChatMessage(input) {
  const typed = (input.text && String(input.text).trim()) || '';
  let choiceId = resolveChoice(input);

  if (!typed && !choiceId) {
    const err = new Error('text or choiceId is required');
    err.status = 400;
    throw err;
  }

  const conversation = await resolveConversation(input);
  if (conversation.status === 'closed') {
    conversation.status = 'ai_handling';
    conversation.assignedAdminId = null;
    conversation.flow = null;
    conversation.unsureStreak = 0;
    await conversation.save();
  }

  // Language: what they type wins, then the site locale, then what we stored.
  // (Not mid-form: a reference like "BK-4821" must not flip the language.)
  let lang = normalizeLang(input.lang || conversation.language);
  const typedLang = detectLang(typed);
  if (typedLang && !conversation.flow?.type) lang = typedLang;
  if (conversation.language !== lang) conversation.language = lang;

  const choiceLabel = ALL_TOPIC_OPTIONS.find((o) => o.id === choiceId);
  const messageText =
    typed ||
    (choiceLabel ? (lang === 'ar' ? choiceLabel.labelAr : choiceLabel.label) : '') ||
    choiceId;

  const saved = await Message.create({
    conversationId: conversation._id,
    sender: 'customer',
    text: messageText,
  });

  await bumpConversationActivity(conversation, 'customer');

  emitToConversation(conversation._id.toString(), 'message:new', {
    sender: 'customer',
    text: messageText,
    messageId: saved._id.toString(),
    conversationId: conversation._id.toString(),
  });

  // Already with a human — don't run AI; alert assigned agent if claimed.
  if (conversation.status === 'claimed' || conversation.status === 'needs_human') {
    if (conversation.status === 'claimed' && conversation.assignedAdminId) {
      await alertAssignedAdmin(conversation, messageText);
    }
    return {
      conversation,
      escalated: conversation.status === 'needs_human',
      answer: null,
      reason: conversation.status === 'claimed' ? 'claimed' : 'already_escalated',
      // Reassure the customer who is still waiting; a claimed chat has a human replying already.
      systemMessage: conversation.status === 'needs_human' ? pickText(REPLIES.humanBusy, lang) : null,
      options: [],
    };
  }

  if (choiceId === 'human' || isExplicitHumanRequest(typed)) {
    return escalate(conversation, 'explicit_human_request', undefined, lang);
  }

  if (isImmediateSafetyEscalation(typed)) {
    return escalate(conversation, 'safety_critical', undefined, lang);
  }

  let settings = null;
  try {
    settings = await getCompanySettings();
  } catch {
    /* optional */
  }

  // Mid-form: a menu click abandons the form; typed text answers the current step.
  if (conversation.flow?.type) {
    if (choiceId) {
      conversation.flow = null;
      await conversation.save();
    } else if (isFlowCancel(typed)) {
      conversation.flow = null;
      await conversation.save();
      return replyAi(conversation, pickText(getGuidedNode('cancel_flow').answer, lang), {
        reason: 'flow_cancelled',
        options: menuOptions(lang),
        lang,
      });
    } else {
      return continueFlow(conversation, typed, settings, lang);
    }
  }

  // Short keyword shortcuts (quote, hours, contact, complaint, lost item) work without the LLM.
  if (!choiceId && typed) {
    const intent = detectIntent(typed);
    if (intent) choiceId = intent;
  }

  const guided = choiceId ? getGuidedNode(choiceId) : null;
  if (guided) {
    if (guided.escalate) {
      return escalate(conversation, 'explicit_human_request', undefined, lang);
    }
    if (guided.startFlow) {
      return startFlow(conversation, guided.startFlow, lang);
    }
    conversation.unsureStreak = 0;
    return replyAi(conversation, guidedAnswerText(choiceId, settings, lang), {
      reason: guided.freeText ? 'guided_free_text' : 'guided',
      topic: choiceId,
      options: resolveGuidedOptions(guided, lang),
      lang,
    });
  }

  const chit = classifyChitchat(typed);
  if (chit) {
    const reply =
      chit === 'thanks'
        ? pickText(REPLIES.thanks, lang)
        : chit === 'bye'
          ? pickText(REPLIES.bye, lang)
          : greetingWelcome(settings, lang);
    return replyAi(conversation, reply, {
      reason: chit === 'hello' ? 'greeting' : 'chitchat',
      options: menuOptions(lang),
      lang,
    });
  }

  let faqEntries;
  try {
    faqEntries = await loadFaqEntries();
  } catch (err) {
    return escalate(conversation, 'faq_load_failed', err.message, lang);
  }

  if (!faqEntries.length) {
    await logMiss(conversation, typed, lang, 'empty_kb');
    return replyAi(conversation, pickText(REPLIES.emptyKb, lang), {
      reason: 'empty_kb',
      options: menuOptions(lang),
      lang,
    });
  }

  let llmResult;
  try {
    llmResult = await generateAnswer({
      question: typed,
      faqEntries,
      history: await recentHistory(conversation._id),
      lang,
    });
  } catch (err) {
    await logMiss(conversation, typed, lang, 'llm_failure');
    return replyAi(conversation, pickText(REPLIES.llmDown, lang), {
      reason: 'llm_failure',
      options: menuOptions(lang),
      detail: err.message,
      lang,
    });
  }

  // The model flagged something staff must handle (safety row, fraud, "manager", …).
  if (looksLikeEscalate(llmResult.answer)) {
    return escalate(conversation, 'model_escalate', undefined, lang);
  }

  if (looksLikeDontKnow(llmResult.answer)) {
    await logMiss(conversation, typed, lang, 'model_uncertain');
    conversation.unsureStreak = (conversation.unsureStreak || 0) + 1;
    if (conversation.unsureStreak >= MAX_UNSURE_STREAK) {
      return escalate(conversation, 'model_uncertain', undefined, lang);
    }
    await conversation.save();
    return replyAi(conversation, pickText(REPLIES.notSure, lang), {
      reason: 'model_uncertain',
      options: localizeOptions([EXTRA_OPTIONS.human, EXTRA_OPTIONS.contact, ...MAIN_MENU_OPTIONS], lang),
      lang,
    });
  }

  conversation.unsureStreak = 0;
  return replyAi(conversation, llmResult.answer, {
    reason: 'faq',
    options: menuOptions(lang),
    provider: llmResult.provider,
    faqCount: faqEntries.length,
    lang,
  });
}

/** Record an unanswered question for the admin log; never breaks the chat. */
async function logMiss(conversation, question, lang, reason) {
  try {
    await logUnanswered({ question, language: lang, reason, conversationId: conversation._id });
  } catch {
    /* best effort */
  }
}

/** Last few turns for the LLM (customer + Durri + staff; system notices skipped). */
async function recentHistory(conversationId, limit = 9) {
  const rows = await Message.find({ conversationId, sender: { $in: ['customer', 'ai', 'admin'] } })
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();
  return rows.reverse().map((m) => ({ role: m.sender === 'customer' ? 'user' : 'assistant', text: m.text }));
}

/* ---------- Guided forms (complaint / lost item) ---------- */

async function startFlow(conversation, type, lang) {
  const form = getForm(type);
  conversation.flow = { type, step: 0, data: {} };
  await conversation.save();
  return replyAi(conversation, `${formIntro(form, lang)}\n\n${stepPrompt(form.steps[0], lang)}`, {
    reason: 'flow_started',
    options: localizeOptions([EXTRA_OPTIONS.cancel_flow], lang),
    lang,
  });
}

async function continueFlow(conversation, text, settings, lang) {
  const form = getForm(conversation.flow.type);
  if (!form) {
    conversation.flow = null;
    await conversation.save();
    return replyAi(
      conversation,
      lang === 'ar' ? 'لنبدأ من جديد، اختر أحد الخيارات أدناه.' : 'Let’s start again — pick an option below.',
      { reason: 'flow_reset', options: menuOptions(lang), lang },
    );
  }

  const step = form.steps[conversation.flow.step];
  const data = { ...(conversation.flow.data || {}) };
  data[step.key] = isFlowSkip(text) ? '' : String(text).trim().slice(0, 1000);
  const nextIndex = conversation.flow.step + 1;

  if (nextIndex < form.steps.length) {
    conversation.flow = { type: conversation.flow.type, step: nextIndex, data };
    await conversation.save();
    return replyAi(conversation, stepPrompt(form.steps[nextIndex], lang), {
      reason: 'flow_step',
      options: localizeOptions([EXTRA_OPTIONS.cancel_flow], lang),
      lang,
    });
  }

  const customer = await Customer.findById(conversation.customerId).lean();
  const slaHours = settings?.complaintSlaHours || 48;

  let refNumber = makeRefNumber(form.refPrefix);
  for (let i = 0; i < 3 && (await Report.exists({ refNumber })); i += 1) {
    refNumber = makeRefNumber(form.refPrefix);
  }

  const report = await Report.create({
    type: form.reportType,
    refNumber,
    customerId: conversation.customerId,
    conversationId: conversation._id,
    name: customer?.name || '',
    phone: customer?.phone || '',
    tripNumber: data.tripNumber || '',
    incidentDate: data.incidentDate || '',
    incidentTime: data.incidentTime || '',
    seat: data.seat || '',
    description: data.description || '',
    slaHours,
  });

  conversation.flow = null;
  await conversation.save();

  notifyAdmins({
    title: form.reportType === 'complaint' ? 'New complaint' : 'New lost item report',
    body: `${refNumber} · ${customer?.name || 'Customer'}${data.tripNumber ? ` · trip ${data.tripNumber}` : ''}`,
    data: {
      type: 'report',
      reportId: report._id.toString(),
      conversationId: conversation._id.toString(),
      url: '/reports',
    },
  }).catch(() => {});

  emitToAdminQueue('report:new', { report });

  return replyAi(
    conversation,
    reportDoneText({ form, refNumber, slaHours, whatsapp: settings?.whatsappNumber, lang }),
    { reason: 'flow_done', options: menuOptions(lang), lang },
  );
}

/* ---------- Replies ---------- */

function replyDelayMs() {
  if (process.env.NODE_ENV === 'test') return 0;
  const configured = Number(process.env.CHAT_REPLY_DELAY_MS);
  if (Number.isFinite(configured) && configured >= 0) return configured;
  return 350 + Math.floor(Math.random() * 350);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function replyAi(conversation, answer, extra = {}) {
  await sleep(replyDelayMs());

  const message = await Message.create({
    conversationId: conversation._id,
    sender: 'ai',
    text: answer,
    reason: extra.reason || '',
    topic: extra.topic || '',
  });

  await bumpConversationActivity(conversation, 'ai');

  emitToConversation(conversation._id.toString(), 'message:new', {
    sender: 'ai',
    text: answer,
    messageId: message._id.toString(),
    conversationId: conversation._id.toString(),
  });

  return {
    conversation,
    escalated: false,
    answer,
    messageId: message._id.toString(),
    options: extra.options ?? menuOptions(extra.lang),
    reason: extra.reason || null,
    provider: extra.provider,
    faqCount: extra.faqCount,
    detail: extra.detail || null,
  };
}

async function resolveConversation(input) {
  if (input.conversationId) {
    if (!/^[a-f0-9]{24}$/i.test(String(input.conversationId))) {
      const err = new Error('Invalid conversationId');
      err.status = 400;
      throw err;
    }
    const existing = await Conversation.findById(input.conversationId);
    if (existing) return existing;
  }

  const name = String(input.customerName || '').trim();
  const email = String(input.customerEmail || '').trim().toLowerCase();
  const phone = String(input.customerPhone || '').trim();

  // No guest fallback: name + phone are required (email is optional).
  if (!name || !phone) {
    const err = new Error('Start a chat session first (name and phone), or pass conversationId');
    err.status = 400;
    throw err;
  }

  const customer = await findOrUpsertCustomer({ name, email, phone });
  return Conversation.create({
    customerId: customer._id,
    status: 'ai_handling',
    language: normalizeLang(input.lang),
    lastActivityAt: new Date(),
  });
}

async function alertAssignedAdmin(conversation, text) {
  const conversationId = conversation._id.toString();
  const assignedAdminId = String(conversation.assignedAdminId);
  const customer = await Customer.findById(conversation.customerId).lean();
  const preview = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 100);
  const name = customer?.name || 'Customer';

  const payload = {
    conversationId,
    assignedAdminId,
    preview,
    customerName: name,
  };

  emitToAdminQueue('conversation:customer_message', payload);

  notifyAdmin(assignedAdminId, {
    title: `${name} replied`,
    body: preview || 'Open the chat to read their message.',
    data: {
      type: 'customer_message',
      conversationId,
      url: `/inbox?c=${conversationId}`,
    },
  }).catch(() => {});
}

/** Extra handover line: team offline (outside office hours) or nobody online to pick it up. */
export async function availabilityNote(lang, now = new Date()) {
  let settings = null;
  try {
    settings = await getCompanySettings();
  } catch {
    return '';
  }
  if (!isOpenNow(settings, now)) {
    const when = nextOpeningText(settings, lang, now);
    return when ? pickText(REPLIES.offlineHours, lang).replace('{when}', when) : '';
  }
  return (await countOnlineAdmins()) === 0 ? pickText(REPLIES.offlineQueued, lang) : '';
}

async function escalate(conversation, reason, detail, lang = 'en') {
  conversation.status = 'needs_human';
  conversation.assignedAdminId = null;
  conversation.flow = null;
  conversation.lastActivityAt = new Date();
  await conversation.save();

  const notice = [
    pickText(reason === 'safety_critical' ? REPLIES.escalatedSafety : REPLIES.escalated, lang),
    await availabilityNote(lang),
  ]
    .filter(Boolean)
    .join(' ');

  const sysMessage = await Message.create({
    conversationId: conversation._id,
    sender: 'system',
    text: notice,
    reason,
  });

  emitToConversation(conversation._id.toString(), 'message:new', {
    sender: 'system',
    text: notice,
    messageId: sysMessage._id.toString(),
    conversationId: conversation._id.toString(),
  });

  const customer = await Customer.findById(conversation.customerId).lean();
  const customerName = customer?.name || null;

  const payload = {
    conversationId: conversation._id.toString(),
    reason,
    detail: detail || null,
    customerName,
  };

  emitToAdminQueue('conversation:escalated', payload);
  emitToConversation(conversation._id.toString(), 'conversation:escalated', payload);

  notifyAdmins({
    title: reason === 'safety_critical' ? 'URGENT: safety issue in chat' : 'Chat waiting',
    body: customerName
      ? `${customerName} ${reason === 'safety_critical' ? 'reported a safety issue.' : 'asked to speak with someone.'}`
      : 'A customer is waiting for a reply in Inbox.',
    data: {
      type: 'escalation',
      url: `/inbox?c=${payload.conversationId}`,
      conversationId: payload.conversationId,
    },
  }).catch(() => {});

  return {
    conversation,
    escalated: true,
    answer: null,
    reason,
    detail: detail || null,
    systemMessage: notice,
    messageId: sysMessage._id.toString(),
    options: [],
  };
}
