import { KnowledgeBaseEntry } from '../models/KnowledgeBaseEntry.js';

/** Soft cap — FAQ sets fit in context; raised for full info.md import. */
export const FAQ_ENTRY_LIMIT = 200;

/**
 * Load FAQ rows from Mongo (title = question, content = answer).
 * @param {{ limit?: number, locale?: string }} [options]
 * @returns {Promise<Array<{
 *   title: string,
 *   content: string,
 *   id: string,
 *   intent?: string,
 *   category?: string,
 *   locale?: string,
 *   escalate?: boolean,
 *   requiresLiveData?: boolean,
 *   sourceId?: string | null,
 * }>>}
 */
export async function loadFaqEntries(options = {}) {
  const limit = options.limit ?? FAQ_ENTRY_LIMIT;
  const filter = {};
  if (options.locale === 'ar' || options.locale === 'en') {
    filter.locale = options.locale;
  }

  const entries = await KnowledgeBaseEntry.find(filter)
    .select(
      'title content intent category locale escalate requiresLiveData sourceId'
    )
    .sort({ sourceId: 1, updatedAt: -1 })
    .limit(limit)
    .lean();

  return entries
    .map((entry) => ({
      id: String(entry._id),
      title: String(entry.title || '').trim(),
      content: String(entry.content || '').trim(),
      intent: entry.intent || '',
      category: entry.category || '',
      locale: entry.locale || 'en',
      escalate: Boolean(entry.escalate),
      requiresLiveData: Boolean(entry.requiresLiveData),
      sourceId: entry.sourceId || null,
    }))
    .filter((entry) => entry.title && entry.content);
}

/* ---------- Retrieval: send the model the relevant rows, not all of them ---------- */

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'do', 'does', 'you', 'your', 'i', 'me', 'my', 'we', 'to', 'of', 'for', 'and', 'or',
  'in', 'on', 'at', 'it', 'can', 'how', 'what', 'when', 'where', 'which', 'who', 'have', 'has', 'with', 'about',
  'من', 'في', 'على', 'الى', 'إلى', 'عن', 'هل', 'ما', 'ماذا', 'كيف', 'متى', 'اين', 'أين', 'هذا', 'هذه', 'ان', 'أن',
  'لا', 'نعم', 'او', 'أو', 'و', 'انا', 'أنا', 'لدي', 'عندي', 'كم',
]);

/** Fold Arabic spelling variants and strip marks so الرحلة / الرحلـة / الرحله match. */
export function normalizeArabic(text) {
  return String(text || '')
    .replace(/[ً-ٰٟـ]/g, '') // tashkeel + tatweel
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي');
}

/** Lower-cased word tokens with Arabic folded and the leading "ال" removed. */
export function tokenize(text) {
  const normalized = normalizeArabic(text).toLowerCase();
  const raw = normalized.match(/[\p{L}\p{N}]+/gu) || [];
  const out = [];
  for (const word of raw) {
    let w = word;
    if (/^[؀-ۿ]/.test(w)) {
      w = w.replace(/^(وال|بال|كال|فال|لل|ال)/, '');
      // light suffix trim for plurals / possessives
      w = w.replace(/(ات|ون|ين|ان|ها|هم|كم|نا|ه)$/, '');
    } else if (w.length > 3) {
      w = w.replace(/(ing|ed|es|s)$/, '');
    }
    if (w.length < 2 || STOP_WORDS.has(w) || STOP_WORDS.has(word)) continue;
    out.push(w);
  }
  return out;
}

/**
 * Pick the FAQ rows most relevant to the question (title weighs more than body).
 * Rows in the user's language get a small boost; escalate rows are always kept.
 * Falls back to the first rows when nothing overlaps, so the model still has context.
 */
export function selectRelevantEntries(entries, question, options = {}) {
  const max = options.max ?? 30;
  const lang = options.lang === 'ar' ? 'ar' : 'en';
  if (!entries?.length) return [];
  if (entries.length <= max) return entries;

  const q = new Set(tokenize(question));
  if (!q.size) return entries.slice(0, max);

  const scored = entries.map((entry, index) => {
    const title = new Set(tokenize(entry.title));
    const body = new Set(tokenize(`${entry.content} ${entry.intent || ''} ${entry.category || ''}`));
    let score = 0;
    for (const token of q) {
      if (title.has(token)) score += 3;
      else if (body.has(token)) score += 1;
    }
    if (score > 0 && entry.locale === lang) score += 0.5;
    return { entry, index, score };
  });

  const ranked = scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index);

  const chosen = new Map();
  for (const s of ranked.slice(0, max)) chosen.set(s.entry.id, s.entry);
  // Always keep rows that force escalation so safety rules stay visible.
  for (const s of scored) if (s.entry.escalate && chosen.size < max + 5) chosen.set(s.entry.id, s.entry);
  // Too little matched? pad with leading rows so general questions still get context.
  for (const s of scored) {
    if (chosen.size >= Math.min(max, 12)) break;
    chosen.set(s.entry.id, s.entry);
  }
  return [...chosen.values()];
}

/**
 * Format FAQ entries for the LLM prompt.
 * @param {Array<{ title: string, content: string, intent?: string, escalate?: boolean, requiresLiveData?: boolean }>} entries
 */
export function formatFaqBlock(entries) {
  if (!entries?.length) return '(no FAQ entries)';

  return entries
    .map((entry, index) => {
      const n = index + 1;
      const meta = [];
      if (entry.intent) meta.push(`intent=${entry.intent}`);
      if (entry.escalate) meta.push('escalate=true');
      if (entry.requiresLiveData) meta.push('requires_live_data=true');
      const metaStr = meta.length ? ` [${meta.join(', ')}]` : '';
      return `${n}. Q: ${entry.title}${metaStr}\n   A: ${entry.content}`;
    })
    .join('\n\n');
}
