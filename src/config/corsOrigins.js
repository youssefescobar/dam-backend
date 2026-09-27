/**
 * Extra browser origins always allowed (marketing site + admin).
 * Merged with CORS_ORIGIN from env when that value is not `*`.
 */
export const EXTRA_CORS_ORIGINS = [
  'https://munnawara-web.vercel.app',
  'https://munnawara-web-saifisvibinns-projects.vercel.app',
  'https://dam-admin-ten.vercel.app',
]

/**
 * Resolve CORS origin config for Express `cors` and Socket.io.
 * @param {string | undefined} raw
 * @returns {true | string | string[] | ((origin: string | undefined, cb: (err: Error | null, allow?: boolean) => void) => void)}
 */
export function resolveCorsOrigin(raw) {
  const value = (raw || '*').trim()
  if (!value || value === '*') return true

  const allowed = [
    ...new Set([
      ...value.split(',').map((item) => item.trim()).filter(Boolean),
      ...EXTRA_CORS_ORIGINS,
    ]),
  ]

  if (allowed.length === 1) return allowed[0]

  return (origin, callback) => {
    if (!origin || allowed.includes(origin)) {
      callback(null, true)
      return
    }
    callback(new Error(`CORS blocked for origin: ${origin}`))
  }
}

/**
 * Flat allowlist for Socket.io (always an array or `true`).
 * @param {string | undefined} raw
 */
export function resolveSocketCorsOrigin(raw) {
  const value = (raw || '*').trim()
  if (!value || value === '*') return true

  return [
    ...new Set([
      ...value.split(',').map((item) => item.trim()).filter(Boolean),
      ...EXTRA_CORS_ORIGINS,
    ]),
  ]
}
