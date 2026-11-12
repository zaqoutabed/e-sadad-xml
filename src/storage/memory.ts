import type { EsadadStore, PaymentLogEntry, TransactionLogEntry } from '../types';

/**
 * In-memory store, for tests and local development only. Logs are lost on
 * restart, so idempotency of payment retries is not guaranteed across
 * restarts or multiple instances. Use a database-backed store in production.
 */
export class InMemoryStore implements EsadadStore {
  readonly transactions: Array<TransactionLogEntry & { id: number }> = [];
  readonly payments: Array<PaymentLogEntry & { id: number }> = [];
  private seq = 0;

  logTransaction(entry: TransactionLogEntry): void {
    this.transactions.push({ id: ++this.seq, ...entry });
  }

  logPayment(entry: PaymentLogEntry): void {
    this.payments.push({ id: ++this.seq, ...entry });
  }

  isPaymentPosted(joebppsTrx: string): boolean {
    return this.payments.some((p) => p.joebppsTrx === joebppsTrx && p.isPaymentPosted);
  }

  markPaymentPosted(joebppsTrx: string): void {
    for (let i = this.payments.length - 1; i >= 0; i--) {
      const p = this.payments[i]!;
      if (p.joebppsTrx === joebppsTrx) {
        p.isPaymentPosted = true;
        return;
      }
    }
  }
}
