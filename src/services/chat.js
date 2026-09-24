import { Conversation } from '../models/Conversation.js';
import { Message } from '../models/Message.js';
import { Customer } from '../models/Customer.js';
import { loadFaqEntries } from './faqPrompt.js';
import {
  generateAnswer,
  looksLikeDontKnow,
  isExplicitHumanRequest,
  isGreetingOrChitchat,
} from './llm.js';
import { notifyAdmins } from './push.js';
import { emitToAdminQueue, emitToConversation } from '../sockets/chat.js';
import {
  MAIN_MENU_OPTIONS,
  getGuidedNode,
  findChoiceIdByLabel,
  resolveGuidedOptions,
  greetingWelcome,
} from '../config/guidedChat.js';

/**
 * Process a customer chat message: guided menu → FAQ-in-prompt LLM → escalate if needed.
 * @param {{
 *   conversationId?: string,
 *   customerName?: string,
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
    await conversation.save();
  }

  await Message.create({
    conversationId: conversation._id,
    sender: 'customer',
    text: text || choiceId,
  });

  emitToConversation(conversation._id.toString(), 'message:new', {
    sender: 'customer',
    text: text || choiceId,
    conversationId: conversation._id.toString(),
  });

  // Already with a human — don't run AI
  if (conversation.status === 'claimed' || conversation.status === 'needs_human') {
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

  const guided = choiceId ? getGuidedNode(choiceId) : null;
  if (guided) {
    if (guided.escalate) {
      return escalate(conversation, 'explicit_human_request');
    }
    const answer = guided.answer || '';
    const options = resolveGuidedOptions(guided.options);
    return replyAi(conversation, answer, {
      reason: guided.freeText ? 'guided_free_text' : 'guided',
      options,
    });
  }

  if (isGreetingOrChitchat(text)) {
    return replyAi(conversation, greetingWelcome(), {
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
      "I don't have enough info in my knowledge base for that yet. Please pick an option below, or ask to talk to a human.",
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
    // Soft-fail: do not escalate — that locks the conversation and blocks all future AI.
    return replyAi(
      conversation,
      "I'm having trouble reaching the AI right now. Please pick a menu option below, try again in a moment, or ask to talk to a human.",
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

async function replyAi(conversation, answer, extra = {}) {
  await Message.create({
    conversationId: conversation._id,
    sender: 'ai',
    text: answer,
  });

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

  let customer = null;
  if (input.customerContact) {
    customer = await Customer.findOne({ contact: input.customerContact });
    if (!customer) {
      customer = await Customer.create({
        name: input.customerName || 'Guest',
        contact: input.customerContact,
        channel: 'web',
      });
    }
  } else {
    customer = await Customer.create({
      name: input.customerName || 'Guest',
      contact: `guest-${Date.now()}@local`,
      channel: 'web',
    });
  }

  return Conversation.create({
    customerId: customer._id,
    status: 'ai_handling',
  });
}

async function escalate(conversation, reason, detail) {
  conversation.status = 'needs_human';
  conversation.assignedAdminId = null;
  await conversation.save();

  const notice =
    "I'm connecting you with a team member who can help. Someone will be with you shortly.";

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

  const payload = {
    conversationId: conversation._id.toString(),
    reason,
    detail: detail || null,
  };

  emitToAdminQueue('conversation:escalated', payload);
  emitToConversation(conversation._id.toString(), 'conversation:escalated', payload);

  notifyAdmins({
    title: 'Chat needs a human',
    body: `Conversation escalated (${reason})`,
    data: { type: 'escalation', url: '/inbox', ...payload },
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
