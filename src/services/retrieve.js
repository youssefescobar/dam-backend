import { KnowledgeBaseEntry } from '../models/KnowledgeBaseEntry.js';
import { embed } from './embedding.js';
import { retrieveTopK } from './rag.js';

/**
 * Load all KB chunks from Mongo and retrieve top-k for a question.
 * @param {string} question
 * @param {{ k?: number }} [options]
 */
export async function retrieveForQuestion(question, options = {}) {
  const k = options.k ?? 3;
  const entries = await KnowledgeBaseEntry.find().lean();
  const corpus = [];
  for (const entry of entries) {
    for (const chunk of entry.chunks || []) {
      corpus.push({
        text: chunk.text,
        embedding: chunk.embedding,
        entryId: String(entry._id),
        title: entry.title,
      });
    }
  }

  if (corpus.length === 0) {
    return { matches: [], queryEmbedding: null, emptyKb: true };
  }

  const queryEmbedding = await embed(question);
  const matches = retrieveTopK(queryEmbedding, corpus, k);
  return { matches, queryEmbedding, emptyKb: false };
}