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
