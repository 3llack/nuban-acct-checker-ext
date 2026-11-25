import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { createServer } from '../../server/server.js';
import { launch, runCheck, showAll, rowsShown, validNumber, shots } from './helpers.js';

const listen = (s) => new Promise((ok) => s.listen(0, '127.0.0.1', () => ok(`http://127.0.0.1:${s.address().port}`)));

const found = validNumber('058', '5');
const missing = validNumber('058', '5', 50);
const SHEET = [
  'Staff Name,Bank,Account Number',
  `Ada Obi,GTB,${found}`,
  `Wrong Person,GTB,${found}`,
  `Nobody Here,GTB,${missing}`,
  `Over Limit,Zenith,${validNumber('057', '3')}`,
].join('\n');

test('extension to backend to (fake) Paystack', async (t) => {
  const fake = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    const acct = url.searchParams.get('account_number');
    res.setHeader('content-type', 'application/json');
    if (url.searchParams.get('bank_code') === '057') {
      res.statusCode = 429;
      return res.end(JSON.stringify({ status: false, message: 'Test mode daily limit of 3 live bank resolves exceeded.' }));
    }
    if (acct === found) return res.end(JSON.stringify({ status: true, data: { account_number: acct, account_name: 'OBI ADA' } }));
    res.statusCode = 422;
    res.end(JSON.stringify({ status: false, message: 'Could not resolve account name.' }));
  });
  const server = createServer({ paystackKey: 'sk_test_fake', paystackBase: await listen(fake), retryDelay: 0, requireOrigin: true, log: () => {} });
  const ext = await launch({ sheetCsv: SHEET, backendUrl: await listen(server) });
  t.after(async () => { await ext.context.close(); server.close(); fake.close(); });

  const { panel } = await ext.openPanelFor('https://docs.google.com/spreadsheets/d/BACKEND/edit#gid=0');
  assert.equal(await panel.isVisible('#demo-badge'), false);
  await runCheck(panel);
  await showAll(panel);
  await panel.screenshot({ path: path.join(shots, 'panel-backend.png'), fullPage: true });
  const rows = await rowsShown(panel);
  assert.deepEqual(rows.map((r) => [r.row, r.status]), [
    [2, 'Name matches'], [3, 'Different name'], [4, 'Not at this bank'], [5, 'Lookup failed'],
  ]);
  assert.match(rows[1].text, /Bank says: OBI ADA/);
  assert.match(rows[3].text, /3 real lookups a day/);
});


test('the extension waits out a per-minute limit instead of failing the rows', async (t) => {
  let limited = 0;
  const backend = http.createServer((req, res) => {
    res.setHeader('access-control-allow-origin', req.headers.origin || '*');
    res.setHeader('access-control-allow-headers', 'content-type');
    if (req.method === 'OPTIONS') return res.end();
    res.setHeader('content-type', 'application/json');
    if (req.url !== '/resolve') { res.statusCode = 404; return res.end('{}'); }
    if (limited < 2) {
      limited++;
      res.statusCode = 429;
      res.setHeader('retry-after', '1');
      return res.end(JSON.stringify({ error: 'Too many lookups at once', scope: 'minute', retry_after: 1 }));
    }
    res.end(JSON.stringify({ found: true, account_name: 'OBI ADA' }));
  });
  const ext = await launch({ sheetCsv: `Staff Name,Bank,Account Number\nAda Obi,GTB,${found}\n`, backendUrl: `${await listen(backend)}/` });
  t.after(async () => { await ext.context.close(); backend.close(); });
  const { panel } = await ext.openPanelFor('https://docs.google.com/spreadsheets/d/WAIT/edit#gid=0');
  await runCheck(panel);
  await showAll(panel);
  assert.deepEqual((await rowsShown(panel)).map((r) => r.status), ['Name matches']);
  assert.equal(limited, 2);
});
