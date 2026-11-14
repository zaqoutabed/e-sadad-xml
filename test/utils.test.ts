import { describe, expect, it } from 'vitest';
import { formatAmount, isAmountInRange, normalizeMobileNumber, parseAmount, toInternationalMobile } from '../src';

describe('normalizeMobileNumber (rules from the reference implementation)', () => {
  it.each([
    ['0599123456', '0599123456'],
    ['599123456', '0599123456'],
    ['970599123456', '0599123456'],
    ['9720599123456', '0599123456'],
    ['972599123456', '0599123456'],
    ['+970 599-123-456', '0599123456'],
    ['00970599123456', '0599123456'],
    ['  0599123456  ', '0599123456'],
  ])('%s -> %s', (input, expected) => {
    expect(normalizeMobileNumber(input)).toBe(expected);
  });

  it.each(['', '123', '0699123456', '05991234567', 'abc0599123456', '97059912345'])('rejects %j', (input) => {
    expect(normalizeMobileNumber(input)).toBe('');
  });

  it('converts to international form', () => {
    expect(toInternationalMobile('0599123456')).toBe('970599123456');
    expect(toInternationalMobile('0599123456', '972')).toBe('972599123456');
  });
});

describe('amounts', () => {
  it('uses the decimal places of each currency', () => {
    expect(formatAmount(10, 'JOD')).toBe('10.000');
    expect(formatAmount(10, 'USD')).toBe('10.00');
    expect(formatAmount(5.5, 'ILS')).toBe('5.50');
    expect(formatAmount(1.005, 'EUR')).toBe('1.01');
    expect(formatAmount(1.0005, 'JOD')).toBe('1.001');
    expect(formatAmount('7', 'EURO')).toBe('7.00');
  });

  it('rejects non-numeric amounts', () => {
    expect(() => formatAmount(Number.NaN, 'ILS')).toThrow(RangeError);
    expect(parseAmount('abc')).toBeUndefined();
    expect(parseAmount(' 12.5 ')).toBe(12.5);
    expect(parseAmount(undefined)).toBeUndefined();
  });

  it('checks ranges inclusively', () => {
    expect(isAmountInRange(1, 1, 10)).toBe(true);
    expect(isAmountInRange(10, 1, 10)).toBe(true);
    expect(isAmountInRange(0.99, 1, 10)).toBe(false);
    expect(isAmountInRange(100)).toBe(true);
  });
});

describe('strict amount parsing', () => {
  it.each(['0x10', '1e3', 'Infinity', '1,000', '12.', '.5', '--1', ''])('rejects %j', (value) => {
    expect(parseAmount(value)).toBeUndefined();
  });
  it.each([
    ['20', 20],
    ['20.50', 20.5],
    ['-1.250', -1.25],
  ])('accepts %j', (value, expected) => {
    expect(parseAmount(value)).toBe(expected);
  });
});
