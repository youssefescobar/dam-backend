import { timingSafeEqual } from 'node:crypto';
import { ipKeyGenerator } from 'express-rate-limit';

/**
 * Express `trust proxy` value. Defaults to trusting only a reverse proxy on the
 * same machine (nginx/caddy on the droplet), so req.ip is the real visitor.
 */
export function trustProxySetting(raw = process.env.TRUST_PROXY) {
  if (raw == null || raw === '') return 'loopback';
  if (/^\d+$/.test(raw)) return Number(raw);
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  return raw;
}

function proxyKeyMatches(given) {
  const want = process.env.CHAT_PROXY_KEY || '';
  if (!want || !given) return false;
  const a = Buffer.from(String(given));
  const b = Buffer.from(want);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Rate-limit key for a public request. The marketing site proxies chat through its
 * own server, so every visitor would share that server's IP; when it presents the
 * shared CHAT_PROXY_KEY we trust the visitor IP it forwards in x-client-ip instead.
 */
export function clientRateKey(req) {
  const forwarded = String(req.get('x-client-ip') || '').trim();
  if (forwarded && proxyKeyMatches(req.get('x-proxy-key'))) {
    return ipKeyGenerator(forwarded);
  }
  return ipKeyGenerator(req.ip);
}
