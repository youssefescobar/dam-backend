import { describe, it, expect } from '@jest/globals';
import { parseKbCsv } from '../../src/utils/csv.js';

describe('parseKbCsv', () => {
  it('parses header title,content with quotes and commas', () => {
    const csv = `title,content
"What is Damic?","Damic is the admin platform."
"Hours","We are open 9-5, Sat closed"
`;
    const rows = parseKbCsv(csv);
    expect(rows).toHaveLength(2);
    expect(rows[0].title).toBe('What is Damic?');
    expect(rows[1].content).toContain('9-5');
  });

  it('accepts question/answer headers', () => {
    const rows = parseKbCsv('question,answer\nQ1,A1\n');
    expect(rows[0]).toEqual({ title: 'Q1', content: 'A1' });
  });
});
