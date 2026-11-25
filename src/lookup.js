import { demoResolve } from './demo.js';
import { BACKEND_URL } from './config.js';

export const isDemo = () => !BACKEND_URL;

const TIMEOUT_MS = 90_000;
const MAX_WAITS = 5;
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));

export async function resolveAccount(accountNumber, bankCode, sheetNameForDemoOnly) {
  if (isDemo()) return demoResolve(accountNumber, sheetNameForDemoOnly);
  const url = `${BACKEND_URL.replace(/\/+$/, '')}/resolve`;
  for (let waits = 0; ; waits++) {
    let res;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ account_number: accountNumber, bank_code: bankCode }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      if (err?.name === 'TimeoutError') throw new Error('The lookup service took too long. Try again.');
      throw new Error('Could not reach the lookup service. Check your connection.');
    }
    let body = null;
    try { body = await res.json(); } catch { }
    if (res.status === 429) {
      const wait = Number(body?.retry_after || res.headers.get('retry-after') || 0);
      if (body?.scope === 'minute' && waits < MAX_WAITS && wait > 0 && wait <= 60) {
        await sleep(wait * 1000);
        continue;
      }
      throw new Error(body?.scope === 'minute' ? 'Too many lookups at once. Try again in a minute.' : 'Daily lookup limit reached. Try again tomorrow.');
    }
    if (res.status === 403) throw new Error('This copy of the extension is not allowed to use the lookup service.');
    if (!res.ok) throw new Error(body?.error || `Lookup service error (${res.status})`);
    return body?.found ? { found: true, accountName: body.account_name } : { found: false };
  }
}
