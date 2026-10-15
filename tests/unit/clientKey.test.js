import { describe, it, expect, afterEach } from '@jest/globals';
import { clientRateKey, trustProxySetting } from '../../src/middleware/clientKey.js';

const req = (headers, ip = '10.0.0.1') => ({
  ip,
  get: (name) => headers[name.toLowerCase()],
});

describe('clientRateKey', () => {
  afterEach(() => {
    delete process.env.CHAT_PROXY_KEY;
  });

  it('uses the forwarded visitor IP only with the shared proxy key', () => {
    process.env.CHAT_PROXY_KEY = 'secret-key';
    expect(clientRateKey(req({ 'x-client-ip': '203.0.113.7', 'x-proxy-key': 'secret-key' }))).toBe(
      '203.0.113.7'
    );
  });

  it('ignores x-client-ip with a wrong or missing key', () => {
    process.env.CHAT_PROXY_KEY = 'secret-key';
    expect(clientRateKey(req({ 'x-client-ip': '203.0.113.7', 'x-proxy-key': 'nope' }))).toBe('10.0.0.1');
    expect(clientRateKey(req({ 'x-client-ip': '203.0.113.7' }))).toBe('10.0.0.1');
  });

  it('ignores x-client-ip when no proxy key is configured', () => {
    expect(clientRateKey(req({ 'x-client-ip': '203.0.113.7', 'x-proxy-key': '' }))).toBe('10.0.0.1');
  });
});

describe('trustProxySetting', () => {
  it('defaults to loopback and parses hop counts', () => {
    expect(trustProxySetting(undefined)).toBe('loopback');
    expect(trustProxySetting('2')).toBe(2);
    expect(trustProxySetting('false')).toBe(false);
  });
});
