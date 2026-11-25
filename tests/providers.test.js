import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createServer } from '../server/server.js';

const listen = (s) => new Promise((ok) => s.listen(0, '127.0.0.1', () => ok(`http://127.0.0.1:${s.address().port}`)));
const json = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body)); };

const paystack = { mode: 'ok', calls: 0 };
const monnify = { logins: 0, lookups: 0, down: false, validToken: null, authSeen: null };

let fakes = [], urls = {}, logs = [];
before(async () => {
  const p = http.createServer((req, res) => {
    paystack.calls++;
    if (paystack.mode === 'flaky') { paystack.mode = 'ok'; return json(res, 422, { status: false, message: 'Could not resolve account name. Check parameters or try again.' }); }
    if (paystack.mode === 'limit-400') return json(res, 400, { status: false, message: 'Test mode daily limit for this endpoint has been reached' });
    if (paystack.mode === 'test-limit') return json(res, 429, { status: false, message: 'Test mode daily limit for this endpoint has been reached' });
    if (paystack.mode === 'down') return json(res, 500, { status: false });
    if (paystack.mode === 'missing') return json(res, 422, { status: false, message: 'Could not resolve account name' });
    return json(res, 200, { status: true, data: { account_name: 'ADA OBI (PAYSTACK)' } });
  });
  const m = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/api/v1/auth/login' && req.method === 'POST') {
      monnify.logins++;
      monnify.authSeen = req.headers.authorization;
      monnify.validToken = `tok${monnify.logins}`;
      return json(res, 200, { requestSuccessful: true, responseMessage: 'success', responseCode: '0', responseBody: { accessToken: monnify.validToken, expiresIn: 3600 } });
    }
    if (url.pathname === '/api/v2/disbursements/account/validate') {
      if (req.headers.authorization !== `Bearer ${monnify.validToken}`) return json(res, 401, { requestSuccessful: false, responseMessage: 'Unauthorized' });
      monnify.lookups++;
      monnify.codeSeen = url.searchParams.get('bankCode');
      if (monnify.down) return json(res, 503, { requestSuccessful: false, responseMessage: 'Service temporarily unavailable' });
      if (url.searchParams.get('accountNumber') === '0000014579' && url.searchParams.get('bankCode') === '011') {
        return json(res, 200, { requestSuccessful: true, responseMessage: 'success', responseCode: '0', responseBody: { accountNumber: '0000014579', accountName: 'ADA OBI', bankCode: '011' } });
      }
      return json(res, 400, { requestSuccessful: false, responseMessage: 'Invalid account number', responseCode: '99' });
    }
    json(res, 404, {});
  });
  urls.paystack = await listen(p);
  urls.monnify = await listen(m);
  fakes = [p, m];
});
after(() => fakes.forEach((f) => f.close()));

async function backend(opts) {
  const server = createServer({ log: (l) => logs.push(l), retryDelay: 0, ...opts });
  const base = await listen(server);
  const resolve = async (account_number, bank_code = '011') => {
    const res = await fetch(`${base}/resolve`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ account_number, bank_code }) });
    return { status: res.status, body: await res.json() };
  };
  return { server, resolve };
}

const both = (order = ['paystack', 'monnify']) => backend({
  paystackKey: 'sk_test_fake', paystackBase: urls.paystack,
  monnify: { apiKey: 'MK_TEST_fake', secretKey: 'secret_fake', base: urls.monnify },
  order,
});

test('Monnify is asked first by default; Paystack is not called when Monnify answers', async () => {
  paystack.mode = 'ok';
  const { server, resolve } = await backend({ paystackKey: 'sk_test_fake', paystackBase: urls.paystack, monnify: { apiKey: 'k', secretKey: 's', base: urls.monnify } });
  try {
    const calls = paystack.calls;
    assert.deepEqual((await resolve('0000014579')).body, { found: true, account_name: 'ADA OBI' });
    assert.equal(paystack.calls, calls);
    assert.match(logs.at(-1), /via monnify$/);
  } finally { server.close(); }
});

test('Paystack answers when it can; Monnify is not called', async () => {
  paystack.mode = 'ok';
  const before = monnify.lookups;
  const { server, resolve } = await both();
  try {
    assert.deepEqual((await resolve('0000014579')).body, { found: true, account_name: 'ADA OBI (PAYSTACK)' });
    assert.equal(monnify.lookups, before);
  } finally { server.close(); }
});

test('a "no such account" is asked twice, then checked with Monnify, before it is believed', async () => {
  paystack.mode = 'missing';
  const { server, resolve } = await both();
  try {
    const calls = paystack.calls, lookups = monnify.lookups;
    assert.deepEqual((await resolve('0000014578')).body, { found: false });
    assert.equal(paystack.calls, calls + 2);
    assert.equal(monnify.lookups, lookups + 1);
    assert.match(logs.at(-1), /via paystack \(not found\)$/);
    assert.deepEqual((await resolve('0000014579')).body, { found: true, account_name: 'ADA OBI' });
  } finally { server.close(); }
});

test('a "no" that turns into an answer on the second try is found', async () => {
  paystack.mode = 'flaky';
  const lookups = monnify.lookups;
  const { server, resolve } = await both();
  try {
    assert.deepEqual((await resolve('0000014579')).body, { found: true, account_name: 'ADA OBI (PAYSTACK)' });
    assert.equal(monnify.lookups, lookups);
    assert.match(logs.at(-1), /via paystack after retry$/);
  } finally { server.close(); }
});

test('the Paystack test limit is never read as "not found", whatever its status code', async () => {
  paystack.mode = 'limit-400';
  const { server, resolve } = await backend({ paystackKey: 'sk_test_fake', paystackBase: urls.paystack });
  try {
    const r = await resolve('0000014579');
    assert.equal(r.status, 503);
    assert.match(r.body.error, /test mode/);
  } finally { server.close(); }
});

test('Paystack limit or outage falls back to Monnify', async () => {
  const { server, resolve } = await both();
  try {
    paystack.mode = 'test-limit';
    assert.deepEqual((await resolve('0000014579')).body, { found: true, account_name: 'ADA OBI' });
    paystack.mode = 'down';
    assert.deepEqual((await resolve('0000014578')).body, { found: false });
    assert.match(logs.at(-1), /via monnify \(not found\)$/);
  } finally { server.close(); }
});

test('Monnify logs in with the key and secret once, and again when the token expires', async () => {
  paystack.mode = 'down';
  const { server, resolve } = await both();
  try {
    const start = monnify.logins;
    await resolve('0000014579');
    await resolve('0000014579');
    assert.equal(monnify.logins, start + 1);
    assert.equal(monnify.authSeen, `Basic ${Buffer.from('MK_TEST_fake:secret_fake').toString('base64')}`);
    monnify.validToken = 'expired-elsewhere';
    assert.equal((await resolve('0000014579')).body.found, true);
    assert.equal(monnify.logins, start + 2);
  } finally { server.close(); }
});

test('both providers down is a clear error, not "not found"', async () => {
  paystack.mode = 'down';
  monnify.down = true;
  const { server, resolve } = await both();
  try {
    const r = await resolve('0000014579');
    assert.equal(r.status, 503);
    assert.match(r.body.error, /busy or down/);
  } finally { server.close(); monnify.down = false; }
});

test('works with Monnify alone', async () => {
  const { server, resolve } = await backend({ monnify: { apiKey: 'k', secretKey: 's', base: urls.monnify } });
  try {
    assert.deepEqual((await resolve('0000014579')).body, { found: true, account_name: 'ADA OBI' });
  } finally { server.close(); }
});

test('Monnify gets its own code for banks that differ from Paystack', async () => {
  const { server, resolve } = await backend({ monnify: { apiKey: 'k', secretKey: 's', base: urls.monnify } });
  try {
    await resolve('0000014579', '999991');
    assert.equal(monnify.codeSeen, '100033');
    await resolve('0000014579', '058');
    assert.equal(monnify.codeSeen, '058');
  } finally { server.close(); }
});

test('refuses to start with no provider keys', () => {
  assert.throws(() => createServer({}), /PAYSTACK_SECRET_KEY/);
});

test('fallback logs never contain account numbers or names', () => {
  assert.ok(logs.length > 0);
  assert.ok(logs.every((l) => !/\d{10}|ADA/.test(l)), logs.join('\n'));
});

test('a burst of lookups logs in to Monnify once, and the startup check reports the login', async () => {
  const { server, resolve } = await backend({ monnify: { apiKey: 'k', secretKey: 's', base: urls.monnify } });
  try {
    const start = monnify.logins;
    await Promise.all(Array.from({ length: 6 }, () => resolve('0000014579')));
    assert.equal(monnify.logins, start + 1);
    assert.deepEqual(await server.checkProviders(), ['monnify: login ok']);
  } finally { server.close(); }
});
