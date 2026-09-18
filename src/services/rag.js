/**
 * Cosine similarity between two equal-length vectors.
 * @param {number[]} a
 * @param {number[]} b
 */
export function cosineSimilarity(a, b) {
  if (!a?.length || !b?.length || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/**
 * Retrieve top-k KB chunks by cosine similarity to the query embedding.
 * @param {number[]} queryEmbedding
 * @param {{ text: string, embedding: number[], entryId?: string, title?: string }[]} corpus
 * @param {number} [k=3]
 */
export function retrieveTopK(queryEmbedding, corpus, k = 3) {
  const scored = corpus
    .filter((c) => Array.isArray(c.embedding) && c.embedding.length > 0)
    .map((c) => ({
      text: c.text,
      entryId: c.entryId,
      title: c.title,
      score: cosineSimilarity(queryEmbedding, c.embedding),
    }))
    .sort((x, y) => y.score - x.score);

  return scored.slice(0, k);
}