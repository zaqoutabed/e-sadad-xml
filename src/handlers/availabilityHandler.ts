import { safeEqual } from '../core/security';
import type { AvailabilityResponse, Logger } from '../types';

export interface AvailabilityResult {
  /** HTTP status code to send. */
  statusCode: number;
  /** JSON body to send. */
  body: AvailabilityResponse;
}

export interface AvailabilityOptions {
  token?: string;
  healthCheck?: () => boolean | void | Promise<boolean | void>;
  logger: Logger;
}

/**
 * Availability Check API (`GET /availability?token=...`), as described in the
 * E-SADAD Availability Check document.
 *
 * - 200 `{ status: "success", availability: {...}, checked_at }` when healthy
 * - 401 when the token is missing or wrong
 * - 503 when no token is configured or the health check fails
 */
export async function checkAvailability(token: unknown, options: AvailabilityOptions): Promise<AvailabilityResult> {
  const started = Date.now();

  if (!options.token) return errorResult(503, 'Service unavailable');
  if (typeof token !== 'string' || !safeEqual(token, options.token)) return errorResult(401, 'Authentication failed');

  try {
    const healthy = options.healthCheck ? await options.healthCheck() : true;
    if (healthy === false) return errorResult(503, 'Target unreachable');
  } catch (err) {
    options.logger.error?.('Availability health check failed', err);
    return errorResult(503, 'Target unreachable');
  }

  return {
    statusCode: 200,
    body: {
      status: 'success',
      availability: { response_time: Date.now() - started, status_code: 200, status_message: 'OK' },
      checked_at: new Date().toISOString(),
    },
  };
}

function errorResult(statusCode: number, message: string): AvailabilityResult {
  return {
    statusCode,
    body: { status: 'error', message, error_code: statusCode, checked_at: new Date().toISOString() },
  };
}
