/**
 * Builds the library configuration from the "config tables" described in the
 * E-SADAD integration document (Biller, eSadad Services, Digital Signature
 * Certificates), whether they live in database tables or in a config file.
 *
 * Column names follow the document (`ServiceTypeCode`, `CertificatePath`, ...).
 * Matching ignores case, underscores and spaces, so database styles such as
 * `service_type_code` or `servicetypecode` work too. Values may be strings, as
 * databases often return them ('1', 'true', '10.500').
 */
import { readFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import type { Currency } from '../constants';
import { EsadadConfigError } from '../errors';
import type { BillerInfo, CertificatesConfig, PaymentType, ServiceConfig } from '../types';

/** A row from any of the config tables: column name → value. */
export type ConfigRow = Record<string, unknown>;

export interface ConfigTables {
  /** Biller table: `BillerCode`, `BillerName`. One row (or the row itself). */
  biller: ConfigRow | ConfigRow[];
  /**
   * eSadad Services table: `ServiceTypeCode`, `ServiceNameArabic`, `ServiceNameEnglish`,
   * `PaymentType`, `Currency`, `BankCode`, `IBAN`, `PartialPayment`, `LowerValue`, `UpperValue`.
   */
  services: ConfigRow[];
  /**
   * Digital Signature Certificates table: `CertificateOwner` (`Esadad` or the biller name),
   * `CertificateType` (`Public` / `Private`), `CertificatePassword`, `CertificatePath`.
   */
  certificates: ConfigRow[];
}

/** The parts of `EsadadConfig` that come from the config tables. */
export interface TablesConfig {
  biller: BillerInfo;
  services: ServiceConfig[];
  certificates: CertificatesConfig;
}

export interface ConfigTablesOptions {
  /** Base folder for relative `CertificatePath` values. Defaults to the current working directory. */
  baseDir?: string;
  /** Environment used to resolve `env:NAME` values. Defaults to `process.env`. */
  env?: Record<string, string | undefined>;
}

// --- reading values from a row ------------------------------------------------

const normalizeKey = (key: string) => key.toLowerCase().replace(/[\s_-]/g, '');

/** Value of a column, matched case-insensitively and ignoring `_`, `-` and spaces. */
function column(row: ConfigRow, name: string): unknown {
  const wanted = normalizeKey(name);
  for (const [key, value] of Object.entries(row)) {
    if (normalizeKey(key) === wanted) return value;
  }
  return undefined;
}

function isEmpty(value: unknown): boolean {
  return value === undefined || value === null || (typeof value === 'string' && value.trim() === '');
}

/** Resolves `env:NAME` to the environment variable `NAME`, so secrets stay out of tables and files. */
function resolveSecret(value: string, where: string, env: ConfigTablesOptions['env']): string {
  if (!value.startsWith('env:')) return value;
  const name = value.slice(4);
  const resolved = (env ?? process.env)[name];
  if (resolved === undefined || resolved === '') throw new EsadadConfigError(`${where}: environment variable ${name} is not set`);
  return resolved;
}

function text(row: ConfigRow, name: string, where: string, options: ConfigTablesOptions, required: true): string;
function text(row: ConfigRow, name: string, where: string, options: ConfigTablesOptions, required?: false): string | undefined;
function text(row: ConfigRow, name: string, where: string, options: ConfigTablesOptions, required = false): string | undefined {
  const value = column(row, name);
  if (isEmpty(value)) {
    if (required) throw new EsadadConfigError(`${where}: column ${name} is required`);
    return undefined;
  }
  return resolveSecret(String(value).trim(), where, options.env);
}

function number(row: ConfigRow, name: string, where: string): number | undefined {
  const value = column(row, name);
  if (isEmpty(value)) return undefined;
  const n = typeof value === 'number' ? value : Number(String(value).trim());
  if (!Number.isFinite(n)) throw new EsadadConfigError(`${where}: column ${name} must be a number (got "${String(value)}")`);
  return n;
}

function bool(row: ConfigRow, name: string, where: string): boolean | undefined {
  const value = column(row, name);
  if (isEmpty(value)) return undefined;
  if (typeof value === 'boolean') return value;
  const s = String(value).trim().toLowerCase();
  if (['true', '1', 'yes', 'y'].includes(s)) return true;
  if (['false', '0', 'no', 'n'].includes(s)) return false;
  throw new EsadadConfigError(`${where}: column ${name} must be true/false (got "${String(value)}")`);
}

function paymentType(value: string, where: string): PaymentType {
  const s = value.toLowerCase().replace(/[\s_-]/g, '');
  if (s === 'prepaid') return 'PrePaid';
  if (s === 'postpaid') return 'PostPaid';
  throw new EsadadConfigError(`${where}: PaymentType must be PrePaid or PostPaid (got "${value}")`);
}

// --- tables → config -----------------------------------------------------------

function toBiller(rows: ConfigRow | ConfigRow[], options: ConfigTablesOptions): BillerInfo {
  const list = Array.isArray(rows) ? rows : [rows];
  if (list.length !== 1) throw new EsadadConfigError(`Biller table must have exactly one row (found ${list.length})`);
  const row = list[0]!;
  return { code: text(row, 'BillerCode', 'Biller', options, true), name: text(row, 'BillerName', 'Biller', options) };
}

function toService(row: ConfigRow, index: number, options: ConfigTablesOptions): ServiceConfig {
  const where = `Services row ${index + 1}`;
  return {
    serviceType: text(row, 'ServiceTypeCode', where, options, true),
    nameAr: text(row, 'ServiceNameArabic', where, options),
    nameEn: text(row, 'ServiceNameEnglish', where, options),
    paymentType: paymentType(text(row, 'PaymentType', where, options, true), where),
    currency: text(row, 'Currency', where, options, true).toUpperCase() as Currency,
    bankCode: text(row, 'BankCode', where, options, true),
    iban: text(row, 'IBAN', where, options, true),
    partialPayment: bool(row, 'PartialPayment', where),
    lowerValue: number(row, 'LowerValue', where),
    upperValue: number(row, 'UpperValue', where),
  };
}

function toCertificates(rows: ConfigRow[], options: ConfigTablesOptions): CertificatesConfig {
  const base = options.baseDir ?? process.cwd();
  const pathOf = (p: string) => (isAbsolute(p) ? p : resolve(base, p));
  let esadadCertificate: CertificatesConfig['esadadCertificate'] | undefined;
  let billerKey: Pick<CertificatesConfig, 'billerPfx' | 'billerPrivateKey'> | undefined;

  rows.forEach((row, index) => {
    const where = `Certificates row ${index + 1}`;
    const owner = text(row, 'CertificateOwner', where, options, true);
    const type = text(row, 'CertificateType', where, options, true).toLowerCase();
    const path = pathOf(text(row, 'CertificatePath', where, options, true));
    const password = text(row, 'CertificatePassword', where, options);
    const isEsadad = normalizeKey(owner) === 'esadad';

    if (isEsadad && type === 'public') {
      esadadCertificate = { path };
    } else if (!isEsadad && type === 'private') {
      billerKey = /\.(pfx|p12)$/i.test(path)
        ? { billerPfx: { path, password: password ?? '' } }
        : { billerPrivateKey: { path, passphrase: password } };
    } else if (type !== 'public' && type !== 'private') {
      throw new EsadadConfigError(`${where}: CertificateType must be Public or Private (got "${type}")`);
    }
    // The E-SADAD private key and the biller public certificate are not needed by the biller: ignored.
  });

  if (!esadadCertificate) throw new EsadadConfigError('Certificates table: missing the E-SADAD Public certificate row');
  if (!billerKey) throw new EsadadConfigError('Certificates table: missing the biller Private certificate row');
  return { esadadCertificate, ...billerKey };
}

/**
 * Converts config-table rows into `biller`, `services` and `certificates`.
 * Spread the result into the `EsadadService` config.
 *
 * @example
 * const tables = { biller: await db.query('SELECT * FROM Biller'), services: ..., certificates: ... };
 * const esadad = new EsadadService({ ...configFromTables(tables), adapter, store });
 */
export function configFromTables(tables: ConfigTables, options: ConfigTablesOptions = {}): TablesConfig {
  if (!tables || typeof tables !== 'object') throw new EsadadConfigError('Config tables are required');
  if (!Array.isArray(tables.services)) throw new EsadadConfigError('Config tables: services must be an array of rows');
  if (!Array.isArray(tables.certificates)) throw new EsadadConfigError('Config tables: certificates must be an array of rows');
  return {
    biller: toBiller(tables.biller, options),
    services: tables.services.map((row, i) => toService(row, i, options)),
    certificates: toCertificates(tables.certificates, options),
  };
}

/**
 * Reads the config tables from a JSON file (`{ "biller": {...}, "services": [...], "certificates": [...] }`).
 * Relative `CertificatePath` values are resolved from the file's folder. Use
 * `"CertificatePassword": "env:BILLER_PFX_PASSWORD"` to keep the password out of the file.
 */
export function loadConfigFile(filePath: string, options: Omit<ConfigTablesOptions, 'baseDir'> = {}): TablesConfig {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(filePath, 'utf8'));
  } catch (err) {
    throw new EsadadConfigError(`Cannot read config file ${filePath}: ${(err as Error).message}`);
  }
  return configFromTables(parsed as ConfigTables, { ...options, baseDir: dirname(resolve(filePath)) });
}
