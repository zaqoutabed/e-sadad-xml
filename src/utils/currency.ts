import { CurrencyDecimals, type Currency } from '../constants';

export function isSupportedCurrency(currency: string): currency is Currency {
  return Object.prototype.hasOwnProperty.call(CurrencyDecimals, currency.toUpperCase());
}

/** Decimal places for a currency (JOD 3; USD, ILS, EUR 2). Unknown currencies use 2. */
export function currencyDecimals(currency: string): number {
  const key = currency.toUpperCase();
  return isSupportedCurrency(key) ? CurrencyDecimals[key] : 2;
}

/**
 * Formats an amount with the decimal places of its currency, for example
 * `formatAmount(10, 'JOD') === '10.000'` and `formatAmount(5.5, 'ILS') === '5.50'`.
 * Rounds half away from zero.
 */
export function formatAmount(amount: number | string, currency: string): string {
  const value = typeof amount === 'string' ? Number(amount) : amount;
  if (!Number.isFinite(value)) throw new RangeError(`Invalid amount: ${amount}`);
  const decimals = currencyDecimals(currency);
  const factor = 10 ** decimals;
  const rounded = Math.sign(value) * Math.round(Math.abs(value) * factor + Number.EPSILON * factor) / factor;
  return rounded.toFixed(decimals);
}

/** Plain decimal number: `20`, `20.5`, `-1.250`. No hex, exponents, `Infinity` or thousands separators. */
const DECIMAL_PATTERN = /^-?\d{1,15}(\.\d{1,6})?$/;

/**
 * Parses an amount from XML text. Returns `undefined` for missing values and
 * for anything that is not a plain decimal number.
 */
export function parseAmount(value: string | undefined): number | undefined {
  const trimmed = value?.trim();
  if (!trimmed || !DECIMAL_PATTERN.test(trimmed)) return undefined;
  return Number(trimmed);
}

/** Checks `amount` against an optional inclusive [lower, upper] range. */
export function isAmountInRange(amount: number, lower?: number, upper?: number): boolean {
  if (lower !== undefined && lower !== null && amount < lower) return false;
  if (upper !== undefined && upper !== null && amount > upper) return false;
  return true;
}
