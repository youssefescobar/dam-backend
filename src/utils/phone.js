/** Just the digits of a phone number ("+966 50-123" -> "96650123"). */
export const digitsOf = (s) => String(s || '').replace(/\D/g, '');

/**
 * Same phone number in any format: the last 9 digits match, so "0501234567",
 * "+966501234567" and "966 50 123 4567" are all one number. Empty never matches.
 */
export function samePhone(a, b) {
  const x = digitsOf(a);
  const y = digitsOf(b);
  return Boolean(x.length >= 6 && y.length >= 6 && x.slice(-9) === y.slice(-9));
}
