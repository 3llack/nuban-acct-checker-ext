import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { extensionCopy } from './helpers.js';

const SAMPLE = '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms';

test('reads a real Google Sheet with the full export, not the limited fallback', { skip: process.env.LIVE !== '1' && 'set LIVE=1' }, async (t) => {
  const extDir = await extensionCopy();
  const context = await chromium.launchPersistentContext(await mkdtemp(path.join(tmpdir(), 'acct-google-')), {
    channel: 'chromium', headless: !process.env.HEADED,
    args: [`--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`],
  });
  t.after(() => context.close());
  const sw = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
  const sheet = await context.newPage();
  await sheet.goto(`https://docs.google.com/spreadsheets/d/${SAMPLE}/edit#gid=0`, { waitUntil: 'domcontentloaded' });
  const tabId = await sw.evaluate(async () => (await chrome.tabs.query({ url: 'https://docs.google.com/*' }))[0].id);
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${new URL(sw.url()).host}/src/panel.html?tab=${tabId}`);
  await panel.click('#check');
  await panel.waitForFunction(() => !document.getElementById('message').hidden);
  assert.match(await panel.textContent('#message'), /Couldn't find an account number column/);
  assert.equal(await panel.evaluate(() => document.body.dataset.source), 'export');
  const options = await panel.$$eval('select[data-col="name"] option', (o) => o.map((x) => x.textContent));
  assert.ok(options.includes('A: Student Name'), options.join(', '));
});
