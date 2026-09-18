import { KnowledgeBaseEntry } from '../models/KnowledgeBaseEntry.js';
import { embedKnowledgeEntry } from './embedding.js';

/**
 * Import KB entries with embeddings.
 * @param {{ title: string, content: string }[]} entries
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

    try {
      const chunks = await embedKnowledgeEntry({ title, content });

      if (mode === 'upsert' && !replaceAll) {
        const existing = await KnowledgeBaseEntry.findOne({ title });
        if (existing) {
          existing.content = content;
          existing.chunks = chunks;
          await existing.save();
          summary.updated += 1;
          continue;
        }
      }

      await KnowledgeBaseEntry.create({ title, content, chunks });
      summary.created += 1;
    } catch (err) {
      summary.errors.push({ title, error: err.message || String(err) });
    }
  }

  return summary;
}
