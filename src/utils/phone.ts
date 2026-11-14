/**
 * Normalises a Palestinian/Israeli mobile number to the local `05XXXXXXXX`
 * form. Returns `''` when the input is not a valid mobile number.
 *
 * Accepted inputs:
 * - `05XXXXXXXX` (10 digits)
 * - `5XXXXXXXX` (9 digits)
 * - `970` or `972` followed by `5XXXXXXXX` or `05XXXXXXXX`, with an optional `+` or `00` prefix
 *
 * Spaces, dashes and parentheses are ignored.
 */
export function normalizeMobileNumber(input: string | null | undefined): string {
  if (!input) return '';
  let n = String(input)
    .trim()
    .replace(/[\s\-()]/g, '');
  if (n.startsWith('+')) n = n.slice(1);
  else if (n.startsWith('00')) n = n.slice(2);
  if (!/^\d+$/.test(n)) return '';

  if ((n.startsWith('970') || n.startsWith('972')) && (n.length === 12 || n.length === 13)) {
    n = n.slice(3);
  }
  if (n.length === 10 && n.startsWith('05')) return n;
  if (n.length === 9 && n.startsWith('5')) return `0${n}`;
  return '';
}

/** Converts a mobile number to international form, for example `0599123456` to `970599123456`. */
export function toInternationalMobile(input: string, countryCode: '970' | '972' = '970'): string {
  const local = normalizeMobileNumber(input);
  return local ? countryCode + local.slice(1) : '';
}
