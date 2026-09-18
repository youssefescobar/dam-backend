/**
 * Split text into ~300–500 token chunks (approx 4 chars/token).
 * @param {string} text
 * @param {{ targetTokens?: number, overlapTokens?: number }} [options]
 * @returns {string[]}
 */
export function chunkText(text, options = {}) {
  const targetTokens = options.targetTokens ?? 400;
  const overlapTokens = options.overlapTokens ?? 40;
  const targetChars = targetTokens * 4;
  const overlapChars = overlapTokens * 4;

  const normalized = String(text || '').trim();
  if (!normalized) return [];

  if (normalized.length <= targetChars) {
    return [normalized];
  }

  const paragraphs = normalized.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const units = paragraphs.length > 1 ? paragraphs : splitSentences(normalized);

  const chunks = [];
  let current = '';

  const flushOversized = (piece) => {
    if (piece.length <= targetChars) {
      chunks.push(piece);
    } else {
      chunks.push(...hardSplit(piece, targetChars, overlapChars));
    }
  };

  for (const unit of units) {
    if (!current) {
      current = unit;
      continue;
    }
    const candidate = `${current}\n\n${unit}`;
    if (candidate.length <= targetChars) {
      current = candidate;
    } else {
      flushOversized(current);
      const overlap = current.slice(-overlapChars);
      current = overlap ? `${overlap}\n\n${unit}` : unit;
    }
  }
  if (current) flushOversized(current);

  return chunks.filter(Boolean);
}

function splitSentences(text) {
  const parts = text.match(/[^.!?]+[.!?]+|[^.!?]+$/g);
  return parts ? parts.map((s) => s.trim()).filter(Boolean) : [text];
}

function hardSplit(text, targetChars, overlapChars) {
  const out = [];
  let i = 0;
  while (i < text.length) {
    const end = Math.min(i + targetChars, text.length);
    out.push(text.slice(i, end));
    if (end >= text.length) break;
    i = Math.max(end - overlapChars, i + 1);
  }
  return out;
}