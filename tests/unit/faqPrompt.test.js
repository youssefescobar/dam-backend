import { describe, it, expect } from '@jest/globals';
import { formatFaqBlock, FAQ_ENTRY_LIMIT } from '../../src/services/faqPrompt.js';

describe('formatFaqBlock', () => {
  it('formats Q/A pairs for the prompt', () => {
    const block = formatFaqBlock([
      { title: 'Hours?', content: 'Open 9-5' },
      { title: 'Airport?', content: 'Yes, we do transfers.' },
    ]);
    expect(block).toContain('1. Q: Hours?');
    expect(block).toContain('A: Open 9-5');
    expect(block).toContain('2. Q: Airport?');
  });

  it('handles empty FAQ', () => {
    expect(formatFaqBlock([])).toBe('(no FAQ entries)');
  });

  it('exports a sane entry limit', () => {
    // The seeded KB alone is 320 rows (160 EN + 160 AR); all of them must reach retrieval.
    expect(FAQ_ENTRY_LIMIT).toBeGreaterThanOrEqual(320);
  });
});
