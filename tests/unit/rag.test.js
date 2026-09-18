import { describe, it, expect } from '@jest/globals';
import { cosineSimilarity, retrieveTopK } from '../../src/services/rag.js';
import { looksLikeDontKnow, isExplicitHumanRequest } from '../../src/services/llm.js';

describe('cosineSimilarity', () => {
  it('returns 1 for identical vectors', () => {
    expect(cosineSimilarity([1, 0, 0], [1, 0, 0])).toBeCloseTo(1);
  });

  it('returns 0 for orthogonal vectors', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
  });
});

describe('retrieveTopK', () => {
  it('returns highest scoring chunks first', () => {
    const q = [1, 0, 0];
    const corpus = [
      { text: 'a', embedding: [0.1, 0.9, 0] },
      { text: 'b', embedding: [0.9, 0.1, 0] },
      { text: 'c', embedding: [0, 1, 0] },
    ];
    const top = retrieveTopK(q, corpus, 2);
    expect(top[0].text).toBe('b');
    expect(top.length).toBe(2);
  });
});

describe('llm helpers', () => {
  it('detects I don\'t know answers', () => {
    expect(looksLikeDontKnow("I don't know")).toBe(true);
    expect(looksLikeDontKnow('Airport transfers are $50')).toBe(false);
  });

  it('detects explicit human requests', () => {
    expect(isExplicitHumanRequest('please talk to a human')).toBe(true);
    expect(isExplicitHumanRequest('What are your hours?')).toBe(false);
  });
});