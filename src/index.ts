// Main entry point: `import { EsadadService } from 'e-sadad-xml'`.

export { EsadadService, createEsadadService } from './service';
export { EsadadError, EsadadConfigError } from './errors';
export { EsadadSigningError } from './core/pipeline';

export {
  ApiNames,
  CurrencyDecimals,
  DefaultResultCodes,
  MessageTypes,
  type ApiName,
  type Currency,
  type ResultCode,
  type ResultCodeKey,
  type ResultCodes,
  type Severity,
} from './constants';

export type * from './types';

// Signing and verification (also useful for simulating E-SADAD in tests).
export { CertificateSigner, signData, verifyData } from './crypto/signature';
export { loadPemPrivateKey, loadPfxPrivateKey, loadPublicKey } from './crypto/keys';
export { signMessage, verifyMessage, type VerifyResult } from './crypto/message';
export { canonicalMsgBody, canonicalize } from './xml/c14n';
export { decodeXmlBody, UnsupportedCharsetError } from './xml/encoding';

// Configuration from config tables / config file (integration document format)
export {
  configFromTables,
  loadConfigFile,
  type ConfigRow,
  type ConfigTables,
  type ConfigTablesOptions,
  type TablesConfig,
} from './config/tables';

// Storage
export { InMemoryStore } from './storage/memory';

// Availability
export { requestAvailability, type AvailabilityClientOptions } from './client/availabilityClient';
export type { AvailabilityResult } from './handlers/availabilityHandler';

// Utilities
export { formatAmount, parseAmount, currencyDecimals, isAmountInRange, isSupportedCurrency } from './utils/currency';
export { normalizeMobileNumber, toInternationalMobile } from './utils/phone';
export { formatTimestamp } from './utils/datetime';
