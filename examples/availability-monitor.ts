/**
 * Availability Check client: checks an endpoint every minute and warns when it
 * is down. `requestAvailability` never throws; problems come back as
 * { status: 'error', message, error_code }.
 */
import { requestAvailability } from 'e-sadad-xml';

const BASE_URL = process.env.ESADAD_URL ?? 'http://localhost:3000';
const TOKEN = process.env.AVAILABILITY_TOKEN ?? 'dev-token';

async function checkOnce(): Promise<void> {
  const result = await requestAvailability({
    baseUrl: BASE_URL,
    path: '/api/v1/esadad/availability', // default is '/availability'
    token: TOKEN,
    timeoutMs: 5000,
  });

  if (result.status === 'success') {
    console.log(`UP   ${result.checked_at}  ${result.availability?.response_time} ms`);
  } else {
    console.warn(`DOWN ${result.checked_at}  ${result.error_code} ${result.message}`); // send an alert here
  }
}

await checkOnce();
setInterval(checkOnce, 60_000);
