/**
 * Message type codes used in `MsgHeader/TrsInf/ReqTyp` and `MsgHeader/TrsInf/ResTyp`.
 *
 * `PREPAID_VALIDATION_RESPONSE` and `PAYMENT_NOTIFICATION_RESPONSE` come from the
 * E-SADAD reference implementation. The BillPull codes follow the standard MFEP
 * naming (`BILPULRQ`/`BILPULRS`) and should be confirmed with E-SADAD.
 */
export const MessageTypes = {
  BILL_PULL_REQUEST: 'BILPULRQ',
  BILL_PULL_RESPONSE: 'BILPULRS',
  PREPAID_VALIDATION_REQUEST: 'BILRPREPADVALRQ',
  PREPAID_VALIDATION_RESPONSE: 'BILRPREPADVALRS',
  PAYMENT_NOTIFICATION_REQUEST: 'BLRPMTNTFRQ',
  PAYMENT_NOTIFICATION_RESPONSE: 'BLRPMTNTFRS',
} as const;

export type Severity = 'Info' | 'Warning' | 'Error';

export interface ResultCode {
  code: number;
  desc: string;
  severity: Severity;
}

/**
 * Result codes returned in `<Result>` blocks.
 *
 * Confirmed from the E-SADAD reference implementation: SUCCESS (0),
 * INVALID_SIGNATURE (2) and INVALID_BILLING_NUMBER (408).
 * The others are library defaults: confirm them with E-SADAD and override
 * through `EsadadConfig.resultCodes` if needed.
 */
export const DefaultResultCodes = {
  SUCCESS: { code: 0, desc: 'Success', severity: 'Info' },
  INVALID_REQUEST: { code: 1, desc: 'Invalid Request', severity: 'Error' },
  INVALID_SIGNATURE: { code: 2, desc: 'Invalid Signature', severity: 'Error' },
  AUTHENTICATION_FAILED: { code: 3, desc: 'Authentication Failed', severity: 'Error' },
  INVALID_BILLER_CODE: { code: 4, desc: 'Invalid Biller Code', severity: 'Error' },
  INVALID_SERVICE_TYPE: { code: 5, desc: 'Invalid Service Type', severity: 'Error' },
  INVALID_CURRENCY: { code: 6, desc: 'Invalid Currency', severity: 'Error' },
  INVALID_AMOUNT: { code: 7, desc: 'Invalid Amount', severity: 'Error' },
  INVALID_BILLING_NUMBER: { code: 408, desc: 'Invalid Billing Number', severity: 'Error' },
  GENERAL_ERROR: { code: 500, desc: 'General Error', severity: 'Error' },
} as const satisfies Record<string, ResultCode>;

export type ResultCodeKey = keyof typeof DefaultResultCodes;
export type ResultCodes = Record<ResultCodeKey, ResultCode>;

/** Supported currencies and the number of decimal places E-SADAD expects for each. */
export const CurrencyDecimals = {
  JOD: 3,
  USD: 2,
  ILS: 2,
  EUR: 2,
  /** Spelling used in the E-SADAD integration document. */
  EURO: 2,
} as const;

export type Currency = keyof typeof CurrencyDecimals;

export const ApiNames = {
  BILL_PULL: 'BillPull',
  PREPAID_VALIDATION: 'PrepaidValidation',
  RECEIVE_PAYMENT_NOTIFICATION: 'ReceivePaymentNotification',
} as const;

export type ApiName = (typeof ApiNames)[keyof typeof ApiNames];
