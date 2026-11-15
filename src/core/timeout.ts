/**
 * Waits for `work`, but gives up after `ms` milliseconds with an error.
 * `ms` undefined or 0 means no limit.
 *
 * Only for read-only work: the underlying operation keeps running after the
 * timeout, so never use this around something that changes data (a payment
 * that "timed out" could still complete and then be posted again on retry).
 */
export async function withTimeout<T>(work: Promise<T> | T, ms: number | undefined, label: string): Promise<T> {
  if (!ms) return work;
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms} ms`)), ms);
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
