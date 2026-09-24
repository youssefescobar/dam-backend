import { KnowledgeBaseEntry } from '../models/KnowledgeBaseEntry.js';

/** Soft cap — small FAQ sets fit in context; guards against accidental huge imports. */
export const FAQ_ENTRY_LIMIT = 80;

/**
 * Load FAQ rows from Mongo (title = question, content = answer).
 * @param {{ limit?: number }} [options]
 * @returns {Promise<{ title: string, content: string, id: string }[]>}
 */
export async function loadFaqEntries(options = {}) {
  const limit = options.limit ?? FAQ_ENTRY_LIMIT;
  const entries = await KnowledgeBaseEntry.find()
    .select('title content')
    .sort({ updatedAt: -1 })
    .limit(limit)
    .lean();

  return entries
    .map((entry) => ({
      id: String(entry._id),
      title: String(entry.title || '').trim(),
      content: String(entry.content || '').trim(),
    }))
    .filter((entry) => entry.title && entry.content);
}

/**
 * Format FAQ entries for the LLM prompt.
 * @param {{ title: string, content: string }[]} entries
 */
export function formatFaqBlock(entries) {
  if (!entries?.length) return '(no FAQ entries)';

  return entries
    .map((entry, index) => {
      const n = index + 1;
      return `${n}. Q: ${entry.title}\n   A: ${entry.content}`;
    })
    .join('\n\n');
}
