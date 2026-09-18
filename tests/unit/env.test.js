import { describe, it, expect } from '@jest/globals';
import { loadEnv } from '../../src/config/env.js';

describe('loadEnv', () => {
  it('fails fast with a clear error if MONGO_URI is missing', () => {
    expect(() =>
      loadEnv({
        JWT_SECRET: 'secret',
      })
    ).toThrow(/MONGO_URI/);
  });

  it('fails fast if JWT_SECRET is missing', () => {
    expect(() =>
      loadEnv({
        MONGO_URI: 'mongodb://localhost:27017/test',
      })
    ).toThrow(/JWT_SECRET/);
  });

  it('loads env when required vars are present', () => {
    const env = loadEnv({
      MONGO_URI: 'mongodb://localhost:27017/test',
      JWT_SECRET: 'secret',
      PORT: '4000',
    });
    expect(env.mongoUri).toBe('mongodb://localhost:27017/test');
    expect(env.jwtSecret).toBe('secret');
    expect(env.port).toBe(4000);
  });
});