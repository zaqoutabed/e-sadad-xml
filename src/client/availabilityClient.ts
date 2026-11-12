import type { AvailabilityResponse } from '../types';

export interface AvailabilityClientOptions {
  /** Base URL, for example `https://esadad.example.com` (no trailing `/availability`). */
  baseUrl: string;
  /** Shared token. */
  token: string;
  /** Request timeout in milliseconds. Defaults to 10000. */
  timeoutMs?: number;
  /** Path of the endpoint. Defaults to `/availability`. */
  path?: string;
}

/**
 * Calls an E-SADAD Availability Check endpoint. Never throws: network errors
 * and timeouts come back as `{ status: "error" }`.
 *
 * @example
 * const result = await requestAvailability({ baseUrl: 'https://host', token: process.env.ESADAD_TOKEN! });
 * if (result.status === 'success') console.log(result.availability?.response_time);
 */
export async function requestAvailability(options: AvailabilityClientOptions): Promise<AvailabilityResponse> {
  const url = new URL(options.path ?? '/availability', options.baseUrl);
  url.searchParams.set('token', options.token);
  const started = Date.now();

  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      signal: AbortSignal.timeout(options.timeoutMs ?? 10_000),
    });
    const body = (await res.json().catch(() => undefined)) as AvailabilityResponse | undefined;
    if (body && (body.status === 'success' || body.status === 'error')) return body;
    return {
      status: res.ok ? 'success' : 'error',
      ...(res.ok
        ? { availability: { response_time: Date.now() - started, status_code: res.status, status_message: res.statusText } }
        : { message: res.statusText || 'Unexpected response', error_code: res.status }),
      checked_at: new Date().toISOString(),
    };
  } catch (err) {
    const timedOut = (err as Error)?.name === 'TimeoutError';
    return {
      status: 'error',
      message: timedOut ? 'Request timed out' : 'Target unreachable',
      error_code: timedOut ? 408 : 503,
      checked_at: new Date().toISOString(),
    };
  }
}
