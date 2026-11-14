import type { ResultCode, ResultCodeKey } from './constants';

/**
 * Throw this from an adapter (or anywhere in a handler) to answer E-SADAD with a
 * specific result code instead of GENERAL_ERROR.
 *
 * @example
 * throw new EsadadError('INVALID_BILLING_NUMBER');
 * throw new EsadadError({ code: 410, desc: 'Account Suspended', severity: 'Error' });
 */
export class EsadadError extends Error {
  readonly result: ResultCodeKey | ResultCode;

  constructor(result: ResultCodeKey | ResultCode, message?: string) {
    super(message ?? (typeof result === 'string' ? result : result.desc));
    this.name = 'EsadadError';
    this.result = result;
  }
}

/** Configuration problem detected when creating the service (missing certificate, duplicate service, ...). */
export class EsadadConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EsadadConfigError';
  }
}
