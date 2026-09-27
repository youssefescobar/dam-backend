import { KnowledgeBaseEntry } from '../models/KnowledgeBaseEntry.js';

/**
 * Import KB FAQ entries (title = question, content = answer).
 * Upsert prefers sourceId when present, else locale + title.
 * @param {Array<{
 *   title: string,
 *   content: string,
 *   sourceId?: string,
 *   intent?: string,
 *   category?: string,
 *   locale?: string,
 *   escalate?: boolean,
 *   requiresLiveData?: boolean,
 * }>} entries
 * @param {{ mode?: 'append' | 'upsert', replaceAll?: boolean }} [options]
 */
export async function importKnowledgeEntries(entries, options = {}) {
  const mode = options.mode === 'append' ? 'append' : 'upsert';
  const replaceAll = Boolean(options.replaceAll);

  if (replaceAll) {
    await KnowledgeBaseEntry.deleteMany({});
  }

  const summary = { created: 0, updated: 0, skipped: 0, errors: [] };

  for (const raw of entries) {
    const title = String(raw.title || '').trim();
    const content = String(raw.content || '').trim();
    if (!title || !content) {
      summary.skipped += 1;
      continue;
    }

    const locale = raw.locale === 'ar' || raw.locale === 'en' ? raw.locale : 'en';
    const payload = {
      title,
      content,
      locale,
      sourceId: raw.sourceId ? String(raw.sourceId).trim() : null,
      intent: raw.intent ? String(raw.intent).trim() : '',
      category: raw.category ? String(raw.category).trim() : '',
      escalate: Boolean(raw.escalate),
      requiresLiveData: Boolean(raw.requiresLiveData),
    };

    try {
      if (mode === 'upsert' && !replaceAll) {
        let existing = null;
        if (payload.sourceId) {
          existing = await KnowledgeBaseEntry.findOne({
            sourceId: payload.sourceId,
            locale,
          });
        }
        if (!existing) {
          existing = await KnowledgeBaseEntry.findOne({ title, locale });
        }
        if (existing) {
          Object.assign(existing, payload);
          await existing.save();
          summary.updated += 1;
          continue;
        }
      }

      await KnowledgeBaseEntry.create(payload);
      summary.created += 1;
    } catch (err) {
      summary.errors.push({ title, error: err.message || String(err) });
    }
  }

  return summary;
}
