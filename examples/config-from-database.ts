/**
 * Configuration from DATABASE config tables (Biller, EsadadServices,
 * EsadadCertificates), as the integration document recommends. Shown with
 * PostgreSQL (`npm i pg`); any database works, since you only pass rows.
 *
 * Column names can be the document's (ServiceTypeCode) or database style
 * (service_type_code): matching ignores case and underscores. String values
 * such as '1', 'true' and '10.500' are converted for you.
 *
 * Usage: `const esadad = await createEsadadService();` before mounting routes.
 */
import { Pool } from 'pg';
import { EsadadService, configFromTables } from 'e-sadad-xml';
import { PostgresStore } from './sql/postgresStore.js';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

/** Reads the config tables and builds the service. Call once at startup. */
export async function createEsadadService(): Promise<EsadadService> {
  const [biller, services, certificates] = await Promise.all([
    pool.query('SELECT biller_code, biller_name FROM esadad_biller'),
    pool.query('SELECT * FROM esadad_services WHERE is_active'),
    pool.query('SELECT certificate_owner, certificate_type, certificate_path, certificate_password FROM esadad_certificates'),
  ]);

  return new EsadadService({
    ...configFromTables(
      { biller: biller.rows, services: services.rows, certificates: certificates.rows },
      { baseDir: '/etc/esadad' }, // relative certificate paths are resolved from here
    ),
    adapter: {
      validatePrepaid: async () => ({ valid: true }),
      postPayment: async () => undefined,
    },
    store: new PostgresStore(pool),
  });
}

/*
Matching tables (PostgreSQL):

CREATE TABLE esadad_biller (biller_code VARCHAR(20) NOT NULL, biller_name VARCHAR(100));

CREATE TABLE esadad_services (
  service_type_code    VARCHAR(100) PRIMARY KEY,
  service_name_arabic  VARCHAR(200),
  service_name_english VARCHAR(200),
  payment_type         VARCHAR(10)  NOT NULL,   -- PrePaid | PostPaid
  currency             VARCHAR(5)   NOT NULL,   -- JOD | USD | ILS | EUR
  bank_code            INTEGER      NOT NULL,
  iban                 VARCHAR(34)  NOT NULL,
  partial_payment      BOOLEAN      NOT NULL DEFAULT FALSE,
  lower_value          NUMERIC(18,3),
  upper_value          NUMERIC(18,3),
  is_active            BOOLEAN      NOT NULL DEFAULT TRUE
);

CREATE TABLE esadad_certificates (
  certificate_owner    VARCHAR(100) NOT NULL,   -- 'Esadad' or the biller name
  certificate_type     VARCHAR(10)  NOT NULL,   -- Public | Private
  certificate_password VARCHAR(200),            -- tip: store 'env:BILLER_PFX_PASSWORD', not the password
  certificate_path     VARCHAR(500) NOT NULL
);
*/
