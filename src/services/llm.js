import { logger } from '../utils/logger.js';
import { formatFaqBlock } from './faqPrompt.js';

export const SYSTEM_PROMPT =
  'You are a warm, friendly assistant for Durrah Al Munawwara Transport (DAMAC). ' +
  'Answer ONLY from the FAQ below — never invent details. ' +
  'Keep replies short and sweet: 1–3 short sentences, plain language, no bullet walls. ' +
  'Sound human and caring, not corporate. ' +
  "Match the user's language (Arabic or English). " +
  'If the FAQ does not contain enough information, reply exactly with: I don\'t know';

/**
 * Cheapest solid text model for FAQ Q&A (high-throughput Flash-Lite).
 * Override with GEMINI_MODEL. Fallback keeps chat up if one id is overloaded.
 */
export const DEFAULT_GEMINI_MODEL = 'gemini-3.1-flash-lite';

const GEMINI_FALLBACK_MODELS = ['gemini-3.5-flash-lite'];

/** @type {((prompt: { question: string, context: string }) => Promise<string>) | null} */
let llmOverride = null;

export function setLlmOverride(fn) {
  llmOverride = fn;
}

export function resetLlmOverride() {
  llmOverride = null;
}

function resolveGeminiModels() {
  const primary = process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL;
  return [primary, ...GEMINI_FALLBACK_MODELS.filter((m) => m !== primary)];
}

/**
 * Call Gemini with the full FAQ injected.
 * @param {{
 *   question: string,
 *   faqEntries?: { title: string, content: string }[],
 * }} input
 * @returns {Promise<{ answer: string, provider: string, model: string }>}
 */
export async function generateAnswer(input) {
  const context = Array.isArray(input.faqEntries)
    ? formatFaqBlock(input.faqEntries)
    : '(no FAQ entries)';

  if (typeof llmOverride === 'function') {
    const answer = await llmOverride({ question: input.question, context });
    return { answer, provider: 'override', model: 'override' };
  }

  if (!process.env.GEMINI_API_KEY) {
    const error = new Error('LLM unavailable: GEMINI_API_KEY not configured');
    error.code = 'LLM_UNAVAILABLE';
    throw error;
  }

  try {
    const { answer, model } = await callGemini(input.question, context);
    return { answer, provider: 'gemini', model };
  } catch (err) {
    logger.warn({ err: err.message }, 'Gemini failed');
    const error = new Error(`LLM unavailable: ${err.message}`);
    error.code = 'LLM_UNAVAILABLE';
    throw error;
  }
}

async function callGemini(question, context) {
  const key = process.env.GEMINI_API_KEY;
  const prompt = `${SYSTEM_PROMPT}\n\nFAQ:\n${context}\n\nQuestion: ${question}`;
  const errors = [];

  for (const model of resolveGeminiModels()) {
    try {
      const answer = await callGeminiModel(key, model, prompt);
      return { answer, model };
    } catch (err) {
      logger.warn({ model, err: err.message }, 'Gemini model failed');
      errors.push(err);
      if (/HTTP 401|HTTP 403|HTTP 429/.test(err.message)) break;
    }
  }

  throw new Error(
    errors.map((e) => e.message).join('; ') || 'Gemini unavailable',
  );
}

async function callGeminiModel(key, model, prompt) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.45,
        maxOutputTokens: 160,
      },
    }),
    signal: AbortSignal.timeout(30000),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Gemini ${model} HTTP ${res.status}: ${body.slice(0, 200)}`);
  }

  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
  return text || "I don't know";
}

export function looksLikeDontKnow(answer) {
  const normalized = String(answer || '')
    .toLowerCase()
    .replace(/['’`]/g, '');
  return (
    normalized.includes('i dont know') ||
    normalized.includes('i do not know') ||
    normalized.includes('im not sure') ||
    normalized.includes('cannot answer') ||
    normalized.includes('cant answer')
  );
}

const HUMAN_REQUEST_RE =
  /\b(talk to (a )?human|speak to (a )?(human|agent|person)|real person|human please|customer service)\b/i;

export function isExplicitHumanRequest(text) {
  return HUMAN_REQUEST_RE.test(String(text || ''));
}

/**
 * Short greetings / chitchat that should not go through FAQ LLM or escalate.
 */
export function isGreetingOrChitchat(text) {
  const t = String(text || '')
    .trim()
    .toLowerCase()
    .replace(/[!?.…]+$/g, '')
    .trim();
  if (!t || t.length > 48) return false;

  return (
    /^(hi|hello|hey|hiya|howdy|hola|salam|assalamu alaikum|as-?salamu alaikum|good (morning|afternoon|evening)|morning|evening)(\s+(there|all|team|guys))?$/.test(
      t
    ) ||
    /^(thanks|thank you|thx|ty|ok|okay|cool|great|nice|bye|goodbye|see you|cheers)$/.test(t) ||
    /^(how are you|how's it going|whats up|what'?s up|wassup)$/.test(t)
  );
}

export function greetingReply(text) {
  const t = String(text || '').toLowerCase();
  if (/thanks|thank you|thx|\bty\b/.test(t)) {
    return "You're so welcome! Anything else I can help with?";
  }
  if (/bye|goodbye|see you/.test(t)) {
    return 'Take care — message us anytime.';
  }
  if (/^(ok|okay|cool|great|nice)\b/.test(t.trim())) {
    return 'Perfect. Ask about routes, hours, Hajj & Umrah, or get a quote anytime.';
  }
  return "Hi! Happy to help with Durrah Al Munawwara transport — routes, hours, Hajj & Umrah, or a quick quote.";
}
