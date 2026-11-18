import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EsadadConfigError, EsadadService, configFromTables, loadConfigFile, type ConfigTables } from '../src';
import { billerIdentity, esadadIdentity } from './helpers';

// Key files on disk, as the Certificates table points to paths.
const dir = mkdtempSync(join(tmpdir(), 'esadad-config-'));
writeFileSync(join(dir, 'ESADAD.cer'), esadadIdentity.certPem);
writeFileSync(join(dir, 'biller.pfx'), billerIdentity.pfx);
writeFileSync(join(dir, 'biller.key'), billerIdentity.keyPem);

/** Rows exactly as the integration document names the columns (dummy values). */
const tables = (): ConfigTables => ({
  biller: { BillerCode: 999, BillerName: 'My Company' },
  services: [
    {
      ServiceTypeCode: 'MOBILE_TOPUP',
      ServiceNameArabic: 'شحن رصيد - بالشيكل',
      ServiceNameEnglish: 'Mobile TopUp - ILS',
      PaymentType: 'PrePaid',
      Currency: 'ILS',
      BankCode: 99,
      IBAN: 'PS00XXXX000000000000000000000',
      PartialPayment: false,
      LowerValue: 1,
      UpperValue: 1000,
    },
  ],
  certificates: [
    { CertificateOwner: 'Esadad', CertificateType: 'Public', CertificatePath: 'ESADAD.cer' },
    {
      CertificateOwner: 'My Company',
      CertificateType: 'Private',
      CertificatePath: 'biller.pfx',
      CertificatePassword: billerIdentity.password,
    },
  ],
});

describe('configFromTables', () => {
  it('maps the document columns to the library config', () => {
    const config = configFromTables(tables(), { baseDir: dir });
    expect(config.biller).toEqual({ code: '999', name: 'My Company' });
    expect(config.services).toEqual([
      {
        serviceType: 'MOBILE_TOPUP',
        nameAr: 'شحن رصيد - بالشيكل',
        nameEn: 'Mobile TopUp - ILS',
        paymentType: 'PrePaid',
        currency: 'ILS',
        bankCode: '99',
        iban: 'PS00XXXX000000000000000000000',
        partialPayment: false,
        lowerValue: 1,
        upperValue: 1000,
      },
    ]);
    expect(config.certificates).toEqual({
      esadadCertificate: { path: join(dir, 'ESADAD.cer') },
      billerPfx: { path: join(dir, 'biller.pfx'), password: billerIdentity.password },
    });
  });

  it('produces a config EsadadService accepts', () => {
    const service = new EsadadService({ ...configFromTables(tables(), { baseDir: dir }), adapter: {} });
    expect(service.getService('MOBILE_TOPUP')?.currency).toBe('ILS');
  });

  it('accepts database-style column names and string values', () => {
    const config = configFromTables(
      {
        biller: [{ biller_code: '999' }],
        services: [
          {
            service_type_code: 'Invoices',
            payment_type: 'postpaid',
            currency: 'jod',
            bank_code: '99',
            iban: 'PS00',
            partial_payment: '1',
            lower_value: '1.500',
            upper_value: null,
          },
        ],
        certificates: [
          { certificateowner: 'ESADAD', certificatetype: 'public', certificatepath: join(dir, 'ESADAD.cer') },
          { certificateowner: 'Biller', certificatetype: 'PRIVATE', certificatepath: 'biller.key' },
        ],
      },
      { baseDir: dir },
    );
    expect(config.services[0]).toMatchObject({ paymentType: 'PostPaid', currency: 'JOD', partialPayment: true, lowerValue: 1.5 });
    expect(config.services[0]!.upperValue).toBeUndefined();
    expect(config.certificates.billerPrivateKey).toEqual({ path: join(dir, 'biller.key'), passphrase: undefined });
  });

  it('resolves env: secrets', () => {
    const t = tables();
    t.certificates[1]!.CertificatePassword = 'env:MY_PFX_PASSWORD';
    const config = configFromTables(t, { baseDir: dir, env: { MY_PFX_PASSWORD: 'from-env' } });
    expect(config.certificates.billerPfx?.password).toBe('from-env');
    expect(() => configFromTables(t, { baseDir: dir, env: {} })).toThrow(/MY_PFX_PASSWORD is not set/);
  });

  it.each([
    ['missing biller code', (t: ConfigTables) => (t.biller = {}), /BillerCode is required/],
    ['two biller rows', (t: ConfigTables) => (t.biller = [{ BillerCode: 1 }, { BillerCode: 2 }]), /exactly one row/],
    ['bad payment type', (t: ConfigTables) => (t.services[0]!.PaymentType = 'Monthly'), /PaymentType must be/],
    ['non-numeric limit', (t: ConfigTables) => (t.services[0]!.LowerValue = 'abc'), /LowerValue must be a number/],
    ['bad boolean', (t: ConfigTables) => (t.services[0]!.PartialPayment = 'maybe'), /PartialPayment must be true\/false/],
    ['no E-SADAD certificate', (t: ConfigTables) => t.certificates.splice(0, 1), /E-SADAD Public certificate/],
    ['no biller key', (t: ConfigTables) => t.certificates.splice(1, 1), /biller Private certificate/],
    ['bad certificate type', (t: ConfigTables) => (t.certificates[0]!.CertificateType = 'Secret'), /Public or Private/],
    ['services not an array', (t: ConfigTables) => ((t as { services: unknown }).services = {}), /services must be an array/],
  ])('reports %s', (_name, mutate, message) => {
    const t = tables();
    mutate(t);
    expect(() => configFromTables(t, { baseDir: dir })).toThrow(EsadadConfigError);
    expect(() => configFromTables(t, { baseDir: dir })).toThrow(message);
  });
});

describe('loadConfigFile', () => {
  it('reads a JSON file and resolves certificate paths from its folder', () => {
    const file = join(dir, 'esadad.config.json');
    writeFileSync(file, JSON.stringify(tables()));
    const config = loadConfigFile(file);
    expect(config.certificates.esadadCertificate).toEqual({ path: join(dir, 'ESADAD.cer') });
    expect(() => new EsadadService({ ...config, adapter: {} })).not.toThrow();
  });

  it('reports unreadable or invalid files', () => {
    expect(() => loadConfigFile(join(dir, 'missing.json'))).toThrow(/Cannot read config file/);
    const bad = join(dir, 'bad.json');
    writeFileSync(bad, '{ not json');
    expect(() => loadConfigFile(bad)).toThrow(EsadadConfigError);
  });
});
