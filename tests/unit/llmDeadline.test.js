import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { generateAnswer } from '../../src/services/llm.js';

describe('Gemini time limit', () => {
  const realFetch = globalThis.fetch;
  let calls;

  beforeEach(() => {
    calls = 0;
    process.env.GEMINI_API_KEY = 'test-key';
    process.env.LLM_DEADLINE_MS = '1500';
    // Every model hangs until its abort signal fires.
    globalThis.fetch = (_url, { signal }) => {
      calls += 1;
      return new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason));
      });
    };
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    delete process.env.GEMINI_API_KEY;
    delete process.env.LLM_DEADLINE_MS;
  });

  it('gives up within the overall deadline instead of waiting on every model', async () => {
    const started = Date.now();
    await expect(generateAnswer({ question: 'hours?', faqEntries: [], lang: 'en' })).rejects.toThrow(/LLM unavailable/);
    expect(Date.now() - started).toBeLessThan(2500);
    expect(calls).toBe(1);
  });
});
