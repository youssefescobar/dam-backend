import { pipeline } from '@huggingface/transformers';
import { chunkText } from './chunking.js';
import { logger } from '../utils/logger.js';

const MODEL_ID = 'Xenova/all-MiniLM-L6-v2';

/** @type {Awaited<ReturnType<typeof pipeline>> | null} */
let extractor = null;
let loading = null;

/** @type {((text: string) => Promise<number[]>) | null} */
let embedOverride = null;

/**
 * Load all-MiniLM-L6-v2 once (feature-extraction pipeline).
 */
export async function initEmbeddingModel() {
  if (extractor) return extractor;
  if (loading) return loading;

  loading = (async () => {
    logger.info(`Loading embedding model ${MODEL_ID}…`);
    extractor = await pipeline('feature-extraction', MODEL_ID);
    logger.info('Embedding model ready');
    return extractor;
  })();

  try {
    return await loading;
  } finally {
    loading = null;
  }
}

/** Snapshot for /health (no model load). */
export function getEmbeddingStatus() {
  return {
    model: MODEL_ID,
    loaded: Boolean(extractor),
    loading: Boolean(loading),
    override: typeof embedOverride === 'function',
  };
}

/**
 * Embed a single string → 384-dim float array (deterministic for same input).
 * @param {string} text
 * @returns {Promise<number[]>}
 */
export async function embed(text) {
  if (typeof embedOverride === 'function') {
    return embedOverride(text);
  }
  const model = await initEmbeddingModel();
  const output = await model(String(text), { pooling: 'mean', normalize: true });
  return Array.from(output.data);
}

export function setEmbedOverride(fn) {
  embedOverride = fn;
}

export function resetEmbedOverride() {
  embedOverride = null;
}

/**
 * Chunk + embed a KB entry (real implementation).
 * @param {{ title: string, content: string }} entry
 * @returns {Promise<{ text: string, embedding: number[] }[]>}
 */
export async function defaultEmbedKnowledgeEntry(entry) {
  const full = `${entry.title}\n\n${entry.content}`.trim();
  const chunks = chunkText(full);
  const result = [];
  for (const chunk of chunks) {
    const embedding = await embed(chunk);
    result.push({ text: chunk, embedding });
  }
  return result;
}

/** @type {(entry: { title: string, content: string }) => Promise<{ text: string, embedding: number[] }[]>} */
let embedKnowledgeEntryFn = defaultEmbedKnowledgeEntry;

export function embedKnowledgeEntry(entry) {
  return embedKnowledgeEntryFn(entry);
}

/**
 * Allow tests to stub the embedder without loading the model.
 * @param {typeof defaultEmbedKnowledgeEntry} fn
 */
export function setEmbedKnowledgeEntry(fn) {
  embedKnowledgeEntryFn = fn;
}

export function resetEmbedKnowledgeEntry() {
  embedKnowledgeEntryFn = defaultEmbedKnowledgeEntry;
}