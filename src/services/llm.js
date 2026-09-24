import { logger } from '../utils/logger.js';
import { formatFaqBlock } from './faqPrompt.js';

export const SYSTEM_PROMPT =
  'You are a helpful assistant for Durrah Al Munawwara Transport (Damic). ' +
  'Answer ONLY using the FAQ provided below. ' +
  'Match the user\'s language (Arabic or English). ' +
  'If the FAQ does not contain enough information to answer, reply exactly with: I don\'t know';

/** @type {((prompt: { question: string, context: string }) => Promise<string>) | null} */
let llmOverride = null;

export function setLlmOverride(fn) {
  llmOverride = fn;
}

export function resetLlmOverride() {
  llmOverride = null;
}

/**
 * Call Groq (primary) or Gemini (fallback) with the full FAQ injected.
 * @param {{
 *   question: string,
 *   faqEntries?: { title: string, content: string }[],
 * }} input
 * @returns {Promise<{ answer: string, provider: string }>}
 */
export async function generateAnswer(input) {
  const context = Array.isArray(input.faqEntries)
    ? formatFaqBlock(input.faqEntries)
    : '(no FAQ entries)';

  if (typeof llmOverride === 'function') {
    const answer = await llmOverride({ question: input.question, context });
    return { answer, provider: 'override' };
  }

  const errors = [];

  if (process.env.GROQ_API_KEY) {
    try {
      const answer = await callGroq(input.question, context);
      return { answer, provider: 'groq' };
    } catch (err) {
      logger.warn({ err: err.message }, 'Groq failed, trying Gemini');
      errors.push(err);
    }
  }

  if (process.env.GEMINI_API_KEY) {
    try {
      const answer = await callGemini(input.question, context);
      return { answer, provider: 'gemini' };
    } catch (err) {
      logger.warn({ err: err.message }, 'Gemini failed');
      errors.push(err);
    }
  }

  const detail = errors.map((e) => e.message).join('; ') || 'No LLM API keys configured';
  const error = new Error(`LLM unavailable: ${detail}`);
  error.code = 'LLM_UNAVAILABLE';
  throw error;
}

async function callGroq(question, context) {
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      temperature: 0.2,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: `FAQ:\n${context}\n\nQuestion: ${question}`,
        },
      ],
    }),
    signal: AbortSignal.timeout(30000),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Groq HTTP ${res.status}: ${body.slice(0, 200)}`);
  }

  const data = await res.json();
  return data.choices?.[0]?.message?.content?.trim() || "I don't know";
}

async function callGemini(question, context) {
  const key = process.env.GEMINI_API_KEY;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${key}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [
        {
          parts: [
            {
              text: `${SYSTEM_PROMPT}\n\nFAQ:\n${context}\n\nQuestion: ${question}`,
            },
          ],
        },
      ],
      generationConfig: { temperature: 0.2 },
    }),
    signal: AbortSignal.timeout(30000),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Gemini HTTP ${res.status}: ${body.slice(0, 200)}`);
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
    return "You're welcome! Anything else I can help with about our transport services?";
  }
  if (/bye|goodbye|see you/.test(t)) {
    return 'Goodbye — feel free to message us anytime.';
  }
  if (/^(ok|okay|cool|great|nice)\b/.test(t.trim())) {
    return 'Great. Ask me about routes, fares, hours, Hajj & Umrah, or worker transfers — or request a quote.';
  }
  return (
    "Hello! I'm the Durrah Al Munawwara assistant. Ask me about our routes, fares, hours, " +
    'Hajj & Umrah transport, or worker transfers. You can also request a quote anytime.'
  );
}
