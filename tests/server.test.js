import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createServer } from '../server/server.js';

let fake, server, base, seenAuth, logs = [];
const listen = (s) => new Promise((ok) => s.listen(0, '127.0.0.1', () => ok(`http://127.0.0.1:${s.address().port}`)));

before(async () => {
  fake = http.createServer((req, res) => {
    seenAuth = req.headers.authorization;
    const url = new URL(req.url, 'http://x');
    res.setHeader('content-type', 'application/json');
    if (url.pathname === '/bank/resolve') {
      if (url.searchParams.get('account_number') === '0000014579' && url.searchParams.get('bank_code') === '011') {
        return res.end(JSON.stringify({ status: true, data: { account_number: '0000014579', account_name: 'ADA OBI', bank_id: 7 } }));
      }
      res.statusCode = 422;
      return res.end(JSON.stringify({ status: false, message: 'Could not resolve account name. Check parameters or try again.' }));
    }
    if (url.pathname === '/bank') return res.end(JSON.stringify({ status: true, data: [{ name: 'First Bank of Nigeria', code: '011', active: true }, { name: 'Gone Bank', code: '999', active: false }] }));
    res.statusCode = 404; res.end('{}');
  });
  const fakeBase = await listen(fake);
  server = createServer({ paystackKey: 'sk_test_fake', paystackBase: fakeBase, perMinute: 5, retryDelay: 0, allowedOrigins: ['chrome-extension://*'], log: (l) => logs.push(l) });
  base = await listen(server);
});
after(() => { server.close(); fake.close(); });

const resolve = (body, headers = {}) => fetch(`${base}/resolve`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });

test('found account returns the bank name and sends the key to Paystack only', async () => {
  const res = await resolve({ account_number: '0000014579', bank_code: '011' });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { found: true, account_name: 'ADA OBI' });
  assert.equal(seenAuth, 'Bearer sk_test_fake');
});

test('unknown account is found: false, not an error', async () => {
  const res = await resolve({ account_number: '0000014578', bank_code: '011' });
  assert.deepEqual(await res.json(), { found: false });
});

test('bad input is rejected before calling Paystack', async () => {
  assert.equal((await resolve({ account_number: '123', bank_code: '011' })).status, 400);
  assert.equal((await fetch(`${base}/resolve`, { method: 'POST', body: 'not json' })).status, 400);
});

test('CORS allows extension origins only', async () => {
  const ok = await resolve({ account_number: '0000014579', bank_code: '011' }, { origin: 'chrome-extension://abc' });
  assert.equal(ok.headers.get('access-control-allow-origin'), 'chrome-extension://abc');
  const other = await resolve({ account_number: '0000014579', bank_code: '011' }, { origin: 'https://evil.example' });
  assert.equal(other.headers.get('access-control-allow-origin'), null);
});

test('rate limit kicks in per caller', async () => {
  let last;
  for (let i = 0; i < 6; i++) last = await resolve({ account_number: '0000014579', bank_code: '011' });
  assert.equal(last.status, 429);
});

test('bank list drops inactive banks', async () => {
  assert.deepEqual(await (await fetch(`${base}/banks`)).json(), [{ name: 'First Bank of Nigeria', code: '011' }]);
});

test('logs never contain account numbers', () => {
  assert.ok(logs.length > 0);
  assert.ok(logs.every((l) => !/\d{10}/.test(l)), logs.join('\n'));
});

async function strictServer(opts) {
  const s = createServer({ paystackKey: 'sk_test_fake', paystackBase: `http://127.0.0.1:${fake.address().port}`, retryDelay: 0, log: () => {}, ...opts });
  return { s, url: await listen(s) };
}
const post = (url, headers = {}) => fetch(`${url}/resolve`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify({ account_number: '0000014579', bank_code: '011' }) });

test('the per-minute limit says how long to wait; the daily limit says so', async () => {
  const { s, url } = await strictServer({ perMinute: 1, perDay: 2 });
  try {
    assert.equal((await post(url)).status, 200);
    const minute = await post(url);
    assert.equal(minute.status, 429);
    const body = await minute.json();
    assert.equal(body.scope, 'minute');
    assert.ok(body.retry_after >= 1 && body.retry_after <= 60);
    assert.equal(minute.headers.get('retry-after'), String(body.retry_after));
  } finally { s.close(); }
  const daily = await strictServer({ perMinute: 100, perDay: 1 });
  try {
    await post(daily.url);
    assert.equal((await (await post(daily.url)).json()).scope, 'day');
  } finally { daily.s.close(); }
});

test('an overall daily cap protects the provider keys whatever the caller address', async () => {
  const { s, url } = await strictServer({ globalPerDay: 2, trustProxy: true });
  try {
    assert.equal((await post(url, { 'cf-connecting-ip': '1.1.1.1' })).status, 200);
    assert.equal((await post(url, { 'cf-connecting-ip': '2.2.2.2' })).status, 200);
    assert.equal((await post(url, { 'cf-connecting-ip': '3.3.3.3' })).status, 429);
  } finally { s.close(); }
});

test('behind the proxy, the edge address wins over a forged X-Forwarded-For', async () => {
  const { s, url } = await strictServer({ perMinute: 1, trustProxy: true });
  try {
    assert.equal((await post(url, { 'cf-connecting-ip': '9.9.9.9', 'x-forwarded-for': '1.0.0.1' })).status, 200);
    assert.equal((await post(url, { 'cf-connecting-ip': '9.9.9.9', 'x-forwarded-for': '1.0.0.2' })).status, 429);
  } finally { s.close(); }
});

test('in production, lookups without an allowed extension origin are refused', async () => {
  const { s, url } = await strictServer({ requireOrigin: true, allowedOrigins: ['chrome-extension://abc'] });
  try {
    assert.equal((await post(url)).status, 403);
    assert.equal((await post(url, { origin: 'chrome-extension://other' })).status, 403);
    assert.equal((await post(url, { origin: 'chrome-extension://abc' })).status, 200);
    assert.equal((await fetch(`${url}/health`)).status, 200);
  } finally { s.close(); }
});

test('a provider that hangs is given up on, not waited for forever', { timeout: 30_000 }, async () => {
  const hang = http.createServer(() => {});
  const hangUrl = await listen(hang);
  const { s, url } = await strictServer({ paystackBase: hangUrl });
  try {
    const started = Date.now();
    const r = await post(url);
    assert.equal(r.status, 503);
    assert.ok(Date.now() - started < 20_000);
  } finally { s.close(); hang.closeAllConnections(); hang.close(); }
});
