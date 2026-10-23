import { describe, it, expect } from '@jest/globals';
import { samePhone } from '../../src/utils/phone.js';

describe('samePhone', () => {
  it('matches one number written different ways', () => {
    expect(samePhone('0501234567', '+966 50 123 4567')).toBe(true);
    expect(samePhone('966501234567', '+966-501-234-567')).toBe(true);
  });

  it('rejects different, empty or too-short numbers', () => {
    expect(samePhone('+966501234567', '+966509999999')).toBe(false);
    expect(samePhone('', '+966501234567')).toBe(false);
    expect(samePhone('123', '123')).toBe(false);
  });
});
