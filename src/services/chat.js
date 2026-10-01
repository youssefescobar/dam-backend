import { Conversation, bumpConversationActivity } from '../models/Conversation.js';
import { Message } from '../models/Message.js';
import { Customer, findOrUpsertCustomer, customerPublic } from '../models/Customer.js';
import { loadFaqEntries } from './faqPrompt.js';
import {
  generateAnswer,
  looksLikeDontKnow,
  isExplicitHumanRequest,
  isImmediateSafetyEscalation,
  isGreetingOrChitchat,
} from './llm.js';
import { notifyAdmins, notifyAdmin } from './push.js';
import { emitToAdminQueue, emitToConversation } from '../sockets/chat.js';
import {
  MAIN_MENU_OPTIONS,
  getGuidedNode,
  findChoiceIdByLabel,
  resolveGuidedOptions,
  greetingWelcome,
  applySettingsToGuidedAnswer,
} from '../config/guidedChat.js';
import { getCompanySettings } from '../models/Settings.js';
import { Report } from '../models/Report.js';
import { getForm, isFlowCancel, isFlowSkip, makeRefNumber } from '../config/guidedForms.js';

/**
 * Start (or resume) a chat session after collecting identity.
 * @param {{ name: string, email: string, phone: string }} input
 */
export async function startChatSession(input) {
  const customer = await findOrUpsertCustomer(input);
  const conversation = await Conversation.create({
    customerId: customer._id,
    status: 'ai_handling',
    lastActivityAt: new Date(),
  });
  return { customer: customerPublic(customer), conversation };
}

/**
 * Process a customer chat message: guided menu → FAQ-in-prompt LLM → escalate if needed.
 * @param {{
 *   conversationId?: string,
 *   customerName?: string,
 *   customerEmail?: string,
 *   customerPhone?: string,
 *   customerContact?: string,
 *   text?: string,
 *   choiceId?: string,
 * }} input
 */
export async function handleChatMessage(input) {
  const choiceId =
    input.choiceId || findChoiceIdByLabel(input.text) || null;
  const text =
    (input.text && String(input.text).trim()) ||
    MAIN_MENU_OPTIONS.find((o) => o.id === choiceId)?.label ||
    '';

  if (!text && !choiceId) {
    const err = new Error('text or choiceId is required');
    err.status = 400;
    throw err;
  }

  const conversation = await resolveConversation(input);
  if (conversation.status === 'closed') {
    conversation.status = 'ai_handling';
    conversation.assignedAdminId = null;
    conversation.flow = null;
    await conversation.save();
  }

  const messageText = text || choiceId;

  await Message.create({
    conversationId: conversation._id,
    sender: 'customer',
    text: messageText,
  });

  await bumpConversationActivity(conversation, 'customer');

  emitToConversation(conversation._id.toString(), 'message:new', {
    sender: 'customer',
    text: messageText,
    conversationId: conversation._id.toString(),
  });

  // Already with a human — don't run AI; alert assigned agent if claimed
  if (conversation.status === 'claimed' || conversation.status === 'needs_human') {
    if (conversation.status === 'claimed' && conversation.assignedAdminId) {
      await alertAssignedAdmin(conversation, messageText);
    }
    return {
      conversation,
      escalated: conversation.status === 'needs_human',
      answer: null,
      reason: conversation.status === 'claimed' ? 'claimed' : 'already_escalated',
      options: [],
    };
  }

  if (choiceId === 'human' || isExplicitHumanRequest(text)) {
    return escalate(conversation, 'explicit_human_request');
  }

  if (isImmediateSafetyEscalation(text)) {
    return escalate(conversation, 'safety_critical');
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
    } else if (isFlowCancel(text)) {
      conversation.flow = null;
      await conversation.save();
      return replyAi(conversation, 'No problem — I’ve cancelled that. What else can I help with?', {
        reason: 'flow_cancelled',
        options: MAIN_MENU_OPTIONS,
      });
    } else {
      return continueFlow(conversation, text, settings);
    }
  }

  const guided = choiceId ? getGuidedNode(choiceId) : null;
  if (guided) {
    if (guided.escalate) {
      return escalate(conversation, 'explicit_human_request');
    }
    if (guided.startFlow) {
      return startFlow(conversation, guided.startFlow);
    }
    const answer =
      applySettingsToGuidedAnswer(choiceId, settings) || guided.answer || '';
    const options = resolveGuidedOptions(guided.options);
    return replyAi(conversation, answer, {
      reason: guided.freeText ? 'guided_free_text' : 'guided',
      options,
    });
  }

  if (isGreetingOrChitchat(text)) {
    return replyAi(conversation, greetingWelcome(settings), {
      reason: 'greeting',
      options: MAIN_MENU_OPTIONS,
    });
  }

  let faqEntries;
  try {
    faqEntries = await loadFaqEntries();
  } catch (err) {
    return escalate(conversation, 'faq_load_failed', err.message);
  }

  if (!faqEntries.length) {
    return replyAi(
      conversation,
      "I don’t have that yet. Pick an option below, or ask to talk to a human.",
      { reason: 'empty_kb', options: MAIN_MENU_OPTIONS },
    );
  }

  let llmResult;
  try {
    llmResult = await generateAnswer({
      question: text,
      faqEntries,
    });
  } catch (err) {
    return replyAi(
      conversation,
      "Sorry, I’m a bit stuck right now. Try a menu option, wait a moment, or ask for a human.",
      {
        reason: 'llm_failure',
        options: MAIN_MENU_OPTIONS,
        detail: err.message,
      },
    );
  }

  if (looksLikeDontKnow(llmResult.answer)) {
    return escalate(conversation, 'model_uncertain');
  }

  return replyAi(conversation, llmResult.answer, {
    reason: 'faq',
    options: MAIN_MENU_OPTIONS,
    provider: llmResult.provider,
    faqCount: faqEntries.length,
  });
}

const CANCEL_OPTION = [{ id: 'cancel_flow', label: 'Cancel', labelAr: 'إلغاء' }];

async function startFlow(conversation, type) {
  const form = getForm(type);
  conversation.flow = { type, step: 0, data: {} };
  await conversation.save();
  return replyAi(conversation, `${form.intro}\n\n${form.steps[0].prompt}`, {
    reason: 'flow_started',
    options: CANCEL_OPTION,
  });
}

async function continueFlow(conversation, text, settings) {
  const form = getForm(conversation.flow.type);
  if (!form) {
    conversation.flow = null;
    await conversation.save();
    return replyAi(conversation, 'Let’s start again — pick an option below.', {
      reason: 'flow_reset',
      options: MAIN_MENU_OPTIONS,
    });
  }

  const step = form.steps[conversation.flow.step];
  const data = { ...(conversation.flow.data || {}) };
  data[step.key] = isFlowSkip(text) ? '' : String(text).trim().slice(0, 1000);
  const nextIndex = conversation.flow.step + 1;

  if (nextIndex < form.steps.length) {
    conversation.flow = { type: conversation.flow.type, step: nextIndex, data };
    await conversation.save();
    return replyAi(conversation, form.steps[nextIndex].prompt, {
      reason: 'flow_step',
      options: CANCEL_OPTION,
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
      url: `/inbox?c=${conversation._id.toString()}`,
    },
  }).catch(() => {});

  const photoNote = settings?.whatsappNumber
    ? ` If you have a photo, send it on WhatsApp (${settings.whatsappNumber}) quoting this number.`
    : '';

  return replyAi(
    conversation,
    `Thank you — your ${form.reportType === 'complaint' ? 'complaint' : 'lost-item report'} is logged as ${refNumber}. Our team will respond within about ${slaHours} hours using the phone number you gave us.${photoNote}`,
    { reason: 'flow_done', options: MAIN_MENU_OPTIONS },
  );
}

function replyDelayMs() {
  if (process.env.NODE_ENV === 'test') return 0;
  const configured = Number(process.env.CHAT_REPLY_DELAY_MS);
  if (Number.isFinite(configured) && configured >= 0) return configured;
  return 900 + Math.floor(Math.random() * 700);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function replyAi(conversation, answer, extra = {}) {
  await sleep(replyDelayMs());

  await Message.create({
    conversationId: conversation._id,
    sender: 'ai',
    text: answer,
  });

  await bumpConversationActivity(conversation, 'ai');

  emitToConversation(conversation._id.toString(), 'message:new', {
    sender: 'ai',
    text: answer,
  });

  return {
    conversation,
    escalated: false,
    answer,
    options: extra.options ?? MAIN_MENU_OPTIONS,
    reason: extra.reason || null,
    provider: extra.provider,
    faqCount: extra.faqCount,
    detail: extra.detail || null,
  };
}

async function resolveConversation(input) {
  if (input.conversationId) {
    const existing = await Conversation.findById(input.conversationId);
    if (existing) return existing;
  }

  const name = String(input.customerName || '').trim();
  const email = String(input.customerEmail || '').trim().toLowerCase();
  const phone = String(input.customerPhone || '').trim();

  // No guest fallback: name + phone are required (email is optional).
  if (!name || !phone) {
    const err = new Error(
      'Start a chat session first (name and phone), or pass conversationId'
    );
    err.status = 400;
    throw err;
  }

  const customer = await findOrUpsertCustomer({ name, email, phone });
  return Conversation.create({
    customerId: customer._id,
    status: 'ai_handling',
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

async function escalate(conversation, reason, detail) {
  conversation.status = 'needs_human';
  conversation.assignedAdminId = null;
  conversation.flow = null;
  conversation.lastActivityAt = new Date();
  await conversation.save();

  const notice =
    "I'm connecting you with a teammate now. Someone will be with you shortly.";

  await Message.create({
    conversationId: conversation._id,
    sender: 'system',
    text: notice,
  });

  emitToConversation(conversation._id.toString(), 'message:new', {
    sender: 'system',
    text: notice,
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
    title: 'Chat waiting',
    body: customerName
      ? `${customerName} asked to speak with someone.`
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
    options: [],
  };
}
