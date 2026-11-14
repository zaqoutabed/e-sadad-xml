/**
 * EsadadStore for SQL Server, using the `mssql` package (npm i mssql).
 * Tables: see schema.sqlserver.sql. Every query is parameterised.
 */
import sql from 'mssql';
import type { EsadadStore, PaymentLogEntry, TransactionLogEntry } from 'e-sadad-xml';

export class SqlServerStore implements EsadadStore {
  constructor(private readonly pool: sql.ConnectionPool) {}

  async logTransaction(e: TransactionLogEntry): Promise<void> {
    await this.pool
      .request()
      .input('type', sql.VarChar(10), e.transactionType)
      .input('api', sql.VarChar(40), e.api)
      .input('guid', sql.VarChar(100), e.guid)
      .input('billingNo', sql.NVarChar(100), e.billingNo ?? null)
      .input('billNo', sql.NVarChar(100), e.billNo ?? null)
      .input('serviceType', sql.NVarChar(100), e.serviceType ?? null)
      .input('currency', sql.VarChar(10), e.currency ?? null)
      .input('resultCode', sql.Int, e.resultCode ?? null)
      .input('xml', sql.NVarChar(sql.MAX), e.xml)
      .input('createdAt', sql.DateTime2, e.createdAt).query(`
        INSERT INTO EsadadTransactionsLogs
          (TransactionType, Api, Guid, BillingNumber, BillNumber, ServiceType, Currency, ResultCode, XmlElement, InsertDateTime)
        VALUES (@type, @api, @guid, @billingNo, @billNo, @serviceType, @currency, @resultCode, @xml, @createdAt)`);
  }

  async logPayment(e: PaymentLogEntry): Promise<void> {
    await this.pool
      .request()
      .input('guid', sql.VarChar(100), e.guid)
      .input('trx', sql.VarChar(100), e.joebppsTrx)
      .input('billingNo', sql.NVarChar(100), e.billingNo)
      .input('billNo', sql.NVarChar(100), e.billNo ?? null)
      .input('serviceType', sql.NVarChar(100), e.serviceType)
      .input('currency', sql.VarChar(10), e.currency ?? null)
      .input('paidAmount', sql.Decimal(18, 3), e.paidAmount)
      .input('createdAt', sql.DateTime2, e.createdAt).query(`
        INSERT INTO EsadadPaymentsLogs
          (Guid, JoebppsTrx, BillingNumber, BillNumber, ServiceType, Currency, PaidAmount, IsPaymentPosted, InsertDateTime)
        VALUES (@guid, @trx, @billingNo, @billNo, @serviceType, @currency, @paidAmount, 0, @createdAt)`);
  }

  async isPaymentPosted(joebppsTrx: string): Promise<boolean> {
    const result = await this.pool
      .request()
      .input('trx', sql.VarChar(100), joebppsTrx)
      .query('SELECT TOP 1 1 AS posted FROM EsadadPaymentsLogs WHERE JoebppsTrx = @trx AND IsPaymentPosted = 1');
    return result.recordset.length > 0;
  }

  async markPaymentPosted(joebppsTrx: string): Promise<void> {
    // Most recent row for this transaction, as the integration document specifies.
    await this.pool.request().input('trx', sql.VarChar(100), joebppsTrx).query(`
      UPDATE EsadadPaymentsLogs SET IsPaymentPosted = 1
      WHERE Id = (SELECT TOP 1 Id FROM EsadadPaymentsLogs WHERE JoebppsTrx = @trx ORDER BY Id DESC)`);
  }
}
