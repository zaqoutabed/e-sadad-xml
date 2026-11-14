/**
 * EsadadStore for PostgreSQL, using the `pg` package (npm i pg).
 * Tables: see schema.postgres.sql. Every query is parameterised ($1, $2, ...).
 */
import type { Pool } from 'pg';
import type { EsadadStore, PaymentLogEntry, TransactionLogEntry } from 'e-sadad-xml';

export class PostgresStore implements EsadadStore {
  constructor(private readonly pool: Pool) {}

  async logTransaction(e: TransactionLogEntry): Promise<void> {
    await this.pool.query(
      `INSERT INTO esadad_transactions_logs
         (transaction_type, api, guid, billing_number, bill_number, service_type, currency, result_code, xml_element, inserted_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        e.transactionType,
        e.api,
        e.guid,
        e.billingNo ?? null,
        e.billNo ?? null,
        e.serviceType ?? null,
        e.currency ?? null,
        e.resultCode ?? null,
        e.xml,
        e.createdAt,
      ],
    );
  }

  async logPayment(e: PaymentLogEntry): Promise<void> {
    await this.pool.query(
      `INSERT INTO esadad_payments_logs
         (guid, joebpps_trx, billing_number, bill_number, service_type, currency, paid_amount, is_payment_posted, inserted_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, FALSE, $8)`,
      [e.guid, e.joebppsTrx, e.billingNo, e.billNo ?? null, e.serviceType, e.currency ?? null, e.paidAmount, e.createdAt],
    );
  }

  async isPaymentPosted(joebppsTrx: string): Promise<boolean> {
    const { rowCount } = await this.pool.query(
      'SELECT 1 FROM esadad_payments_logs WHERE joebpps_trx = $1 AND is_payment_posted LIMIT 1',
      [joebppsTrx],
    );
    return (rowCount ?? 0) > 0;
  }

  async markPaymentPosted(joebppsTrx: string): Promise<void> {
    // Most recent row for this transaction, as the integration document specifies.
    await this.pool.query(
      `UPDATE esadad_payments_logs SET is_payment_posted = TRUE
       WHERE id = (SELECT id FROM esadad_payments_logs WHERE joebpps_trx = $1 ORDER BY id DESC LIMIT 1)`,
      [joebppsTrx],
    );
  }
}

/*
Usage:

import { Pool } from 'pg';
const store = new PostgresStore(new Pool({ connectionString: process.env.DATABASE_URL }));
const esadad = new EsadadService({ ..., store });
*/
