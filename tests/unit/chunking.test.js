import { describe, it, expect } from '@jest/globals';
import { chunkText } from '../../src/services/chunking.js';

describe('chunkText', () => {
  it('returns a single chunk for short text', () => {
    expect(chunkText('hello world')).toEqual(['hello world']);
  });

  it('produces multiple chunks for long text (1000+ words)', () => {
    const words = Array.from({ length: 1200 }, (_, i) => `word${i}`).join(' ');
    const chunks = chunkText(words);
    expect(chunks.length).toBeGreaterThan(1);
  });
});