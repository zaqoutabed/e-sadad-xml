import { DefaultResultCodes, type ResultCode, type ResultCodeKey, type ResultCodes } from '../constants';
import { EsadadError } from '../errors';
import type { ResultInput } from '../types';

/**
 * Turns result keys (`'INVALID_BILLING_NUMBER'`), result objects and thrown
 * errors into the `ResultCode` written to the XML response.
 */
export class ResultResolver {
  readonly codes: ResultCodes;

  constructor(overrides: Partial<ResultCodes> = {}) {
    this.codes = { ...DefaultResultCodes, ...overrides };
  }

  get success(): ResultCode {
    return this.codes.SUCCESS;
  }

  /** Resolves a key or object. Falls back to `fallback` when `input` is empty or unknown. */
  resolve(input: ResultInput | undefined, fallback: ResultCodeKey): ResultCode {
    if (!input) return this.codes[fallback];
    if (typeof input === 'string') return this.codes[input] ?? this.codes[fallback];
    return input;
  }

  /** `EsadadError` maps to its own code; anything else becomes GENERAL_ERROR. */
  fromError(err: unknown): ResultCode {
    if (err instanceof EsadadError) return this.resolve(err.result, 'GENERAL_ERROR');
    return this.codes.GENERAL_ERROR;
  }
}
