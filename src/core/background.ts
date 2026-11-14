import type { Logger } from '../types';

/**
 * Runs a task after the current request has been answered, without waiting
 * for it. Errors are logged and never reach E-SADAD.
 *
 * Used for hooks (SMS, e-mail, webhooks, metrics) that must not slow down or
 * break the response.
 */
export function runInBackground(label: string, task: () => unknown, logger: Logger): void {
  setImmediate(() => {
    Promise.resolve()
      .then(task)
      .catch((err: unknown) => logger.error?.(`${label} failed`, err));
  });
}
