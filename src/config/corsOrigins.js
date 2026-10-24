/**
 * Extra browser origins always allowed (marketing site + admin).
 * Merged with CORS_ORIGIN from env when that value is not `*`.
 */
const EXTRA_CORS_ORIGINS = [
  'https://munnawara-web.vercel.app',
  'https://munnawara-web-saifisvibinns-projects.vercel.app',
  'https://dam-admin-ten.vercel.app',
  'https://admin.104-248-198-154.sslip.io',
]

/**
 * Allowed browser origins for Express `cors` and Socket.io: `true` (any) when CORS_ORIGIN is
 * unset or `*`, otherwise the listed origins plus the extras. A disallowed origin simply gets no
 * CORS headers (the browser blocks it) instead of a server error.
 * @param {string | undefined} raw
 * @returns {true | string[]}
 */
export function resolveCorsOrigin(raw) {
  const value = (raw || '*').trim()
  if (!value || value === '*') return true

  return [
    ...new Set([
      ...value.split(',').map((item) => item.trim()).filter(Boolean),
      ...EXTRA_CORS_ORIGINS,
    ]),
  ]
}
