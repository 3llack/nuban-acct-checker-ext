import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { launch, runCheck, showAll, rowsShown, validNumber, shots } from './helpers.js';

const ada = validNumber('058', '8');
const SHEET = [
  'November 2026 salary,,,,',
  'S/N,Staff Name,Bank,Account Number,Net Pay',
  `1,Ada Obi,GTB,${ada},250000`,
  `2,Musa Ibrahim,Zenith Bank,${validNumber('057', '1')},180000`,
  `3,Chinedu Okafor,UBA,${validNumber('033', '2')},180000`,
  `4,Grace Eze,First Bank,${validNumber('011', '0')},150000`,
  `5,Bad Digit,GTBank,${ada.slice(0, 9)}${(Number(ada[9]) + 1) % 10},150000`,
  '6,Too Short,GTB,12345,150000',
  `7,Unknown Bank,Nowhere Bank,${ada},150000`,
  `8,Lost Zero,Access Bank,${validNumber('044', '8').replace(/^0/, '')},150000`,
  `9,Ada Obi,GTB,${ada},250000`,
  `10,Old Account,Heritage Bank,${validNumber('030', '8')},150000`,
  'Total,,,,1460000',
].join('\n');

let ext;
before(async () => { ext = await launch({ sheetCsv: SHEET }); });
after(() => ext?.context.close());

test('checks a salary sheet end to end', async () => {
  const { tab, panel } = await ext.openPanelFor('https://docs.google.com/spreadsheets/d/TESTSHEET/edit#gid=0');
  assert.equal(await panel.isVisible('#demo-badge'), true);
  assert.equal(await panel.getAttribute('#site-link', 'href'), 'https://266labs.com');
  assert.equal(await panel.getAttribute('#tips-link', 'href'), 'https://paystack.shop/pay/mkp6mhtho4');
  assert.equal(await panel.isVisible('#tips-link'), true);
  await runCheck(panel);
  await panel.screenshot({ path: path.join(shots, 'panel-needs-attention.png'), fullPage: true });

  assert.equal(await panel.textContent('#sheet-title'), 'November salary');
  assert.deepEqual(await panel.$$eval('select[data-col]', (s) => s.map((x) => [x.dataset.col, x.value])),
    [['name', '1'], ['account', '3'], ['bank', '2']]);

  const attention = await rowsShown(panel);
  assert.deepEqual(attention.map((r) => [r.row, r.status]), [
    [4, 'Different name'], [5, 'Partly matches'], [6, 'Not at this bank'],
    [7, 'Wrong for this bank'], [8, 'Invalid number'], [9, "Can't check"], [12, 'Bank closed'],
  ]);
  assert.match(attention.find((r) => r.row === 6).text, /No First Bank account has this number/);
  assert.match(attention.find((r) => r.row === 7).text, /Not a valid GTBank account number/);
  assert.match(attention.find((r) => r.row === 12).text, /lost its licence/);

  await showAll(panel);
  const all = await rowsShown(panel);
  assert.deepEqual(all.map((r) => [r.row, r.status]), [
    [3, 'Name matches'], [4, 'Different name'], [5, 'Partly matches'], [6, 'Not at this bank'],
    [7, 'Wrong for this bank'], [8, 'Invalid number'], [9, "Can't check"], [10, 'Name matches'], [11, 'Name matches'],
    [12, 'Bank closed'],
  ]);
  assert.match(all.find((r) => r.row === 10).text, /Leading zero was missing/);
  assert.match(all.find((r) => r.row === 3).text, /Same account as row 11/);
  await panel.screenshot({ path: path.join(shots, 'panel-all.png'), fullPage: true });

  await panel.locator('#list li', { hasText: 'Row 7' }).click();
  await tab.waitForURL(/range=D7/);

  await panel.evaluate(() => { navigator.clipboard.writeText = async (text) => { window.copied = text; }; });
  await panel.click('#copy');
  await panel.waitForFunction(() => typeof window.copied === 'string');
  const lines = (await panel.evaluate(() => window.copied)).split('\n');
  assert.equal(lines[0], 'Account check');
  assert.equal(lines[1], 'Name matches');
  assert.equal(lines[2], 'Different name: ADEYEMI CHIOMA BELLO');
  assert.equal(lines[5], 'Wrong for this bank: Not a valid GTBank account number');
  assert.equal(lines.length, 11);
  assert.match(await panel.textContent('#copy-hint'), /row 2/);

  const [download] = await Promise.all([panel.waitForEvent('download'), panel.click('#download')]);
  const csv = await readFile(await download.path(), 'utf8');
  assert.match(csv.split('\r\n')[0], /"Row","Name on sheet","Account number","Bank","Result"/);
  assert.equal(csv.split('\r\n').length, 11);
});

test('changing the name column to none still checks account and bank', async () => {
  const { panel } = await ext.openPanelFor('https://docs.google.com/spreadsheets/d/NONAME/edit#gid=0');
  await runCheck(panel);
  await panel.selectOption('select[data-col="name"]', '-1');
  await panel.waitForFunction(() => document.getElementById('progress').hidden);
  await showAll(panel);
  const statuses = (await rowsShown(panel)).map((r) => r.status);
  assert.ok(statuses.includes('Account found'));
  assert.ok(!statuses.some((s) => /name/i.test(s)), statuses.join(', '));
});

test('falls back to gviz when the export is refused', async () => {
  ext.state.exportStatus = 403;
  try {
    const { panel } = await ext.openPanelFor('https://docs.google.com/spreadsheets/d/GVIZ/edit#gid=0');
    await runCheck(panel);
    assert.ok((await rowsShown(panel)).length > 0);
    assert.match(await panel.textContent('#message'), /limited mode/);
  } finally { ext.state.exportStatus = 200; }
});

test('explains what to do on a page that is not a sheet', async () => {
  const { panel } = await ext.openPanelFor('https://example.com/');
  await panel.click('#check');
  assert.match(await panel.textContent('#message'), /Open your salary sheet in Google Sheets/);
});

test('explains Excel files opened in Sheets', async () => {
  const { panel } = await ext.openPanelFor('https://docs.google.com/spreadsheets/d/XLSX/edit?rtpof=true#gid=0');
  await panel.click('#check');
  assert.match(await panel.textContent('#message'), /Save as Google Sheets/);
});

test('reads every tab of a workbook and can check them together', async () => {
  const header = 'Name,Bank,Account Number';
  ext.state.tabs = [
    { name: 'Sales', gid: '0', csv: [header, `Ada Obi,GTB,${ada}`, `Femi Ade,UBA,${validNumber('033', '8')}`].join('\n') },
    { name: 'Ops', gid: '555', csv: [header, `Ada Obi,GTBank,${ada}`].join('\n') },
    { name: 'Notes', gid: '777', csv: 'Notes\npay on the 25th' },
  ];
  try {
    const { tab, panel } = await ext.openPanelFor('https://docs.google.com/spreadsheets/d/TABS/edit#gid=555');
    await runCheck(panel);
    assert.equal(await panel.inputValue('#tab-pick'), '1');
    assert.deepEqual(await panel.$$eval('#tab-pick option', (o) => o.map((x) => x.textContent)),
      ['All tabs (2)', 'Sales', 'Ops', 'Notes (no account column)']);
    await showAll(panel);
    assert.deepEqual((await rowsShown(panel)).map((r) => r.where), ['Row 2']);

    await panel.selectOption('#tab-pick', 'all');
    await panel.waitForFunction(() => document.getElementById('progress').hidden
      && ![...document.querySelectorAll('.pill')].some((p) => p.textContent === 'Checking'));
    await showAll(panel);
    const rows = await rowsShown(panel);
    assert.deepEqual(rows.map((r) => r.where), ['Sales · Row 2', 'Sales · Row 3', 'Ops · Row 2']);
    assert.match(rows[0].text, /Same account as Ops row 2/);
    assert.equal(await panel.isDisabled('#copy'), true);
    assert.equal(await panel.isVisible('#pickers'), false);
    await panel.screenshot({ path: path.join(shots, 'panel-tabs.png'), fullPage: true });

    await panel.locator('#list li', { hasText: 'Sales · Row 3' }).click();
    await tab.waitForURL(/gid=0&range=C3/);
  } finally { ext.state.tabs = null; }
});

test('checks an Excel file dropped into the panel, without a Google Sheet', async () => {
  const XLSX = await import('../../src/vendor/xlsx.mjs');
  const ws = XLSX.utils.aoa_to_sheet([
    ['Staff Name', 'Bank', 'Account No'],
    ['Ada Obi', 'GTB', Number(validNumber('058', '8', 10000000))],
    ['Femi Ade', 'UBA', validNumber('033', '8')],
  ]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'November');
  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

  const { panel } = await ext.openPanelFor('https://example.com/');
  await panel.setInputFiles('#file', { name: 'November.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer });
  await panel.locator('#results').waitFor();
  await panel.waitForFunction(() => document.getElementById('progress').hidden
    && ![...document.querySelectorAll('.pill')].some((p) => p.textContent === 'Checking'));
  assert.equal(await panel.textContent('#sheet-title'), 'November.xlsx');
  assert.equal(await panel.evaluate(() => document.body.dataset.source), 'file');
  assert.equal(await panel.isVisible('#tab-pick-wrap'), false);
  await showAll(panel);
  const rows = await rowsShown(panel);
  assert.deepEqual(rows.map((r) => [r.row, r.status]), [[2, 'Name matches'], [3, 'Name matches']]);
  assert.match(rows[0].text, /Leading zero/);
  assert.equal(await panel.locator('#list li.no-jump').count(), 2);
  await panel.screenshot({ path: path.join(shots, 'panel-file.png'), fullPage: true });

  await panel.setInputFiles('#file', { name: 'photo.png', mimeType: 'image/png', buffer: Buffer.from('x') });
  await panel.waitForFunction(() => /Couldn't read photo.png/.test(document.getElementById('message').textContent));
});

test('a dropped file with several tabs can be switched and checked together', async () => {
  const XLSX = await import('../../src/vendor/xlsx.mjs');
  const wb = XLSX.utils.book_new();
  const header = ['Name', 'Bank', 'Account Number'];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([header, ['Ada Obi', 'GTB', ada]]), 'Sales');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Notes'], ['pay on the 25th']]), 'Notes');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([header, ['Ada Obi', 'GTBank', ada], ['Femi Ade', 'UBA', validNumber('033', '8')]]), 'Ops');
  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  const settled = () => panel.waitForFunction(() => document.getElementById('progress').hidden
    && ![...document.querySelectorAll('.pill')].some((p) => p.textContent === 'Checking'));

  const { panel } = await ext.openPanelFor('https://example.com/');
  await panel.setInputFiles('#file', { name: 'Payroll.xlsx', mimeType: 'application/octet-stream', buffer });
  await panel.locator('#results').waitFor();
  await settled();
  assert.deepEqual(await panel.$$eval('#tab-pick option', (o) => o.map((x) => x.textContent)),
    ['All tabs (2)', 'Sales', 'Notes (no account column)', 'Ops']);
  assert.equal(await panel.inputValue('#tab-pick'), '0');
  await showAll(panel);
  assert.deepEqual((await rowsShown(panel)).map((r) => r.where), ['Row 2']);

  await panel.selectOption('#tab-pick', '2');
  await settled();
  assert.deepEqual((await rowsShown(panel)).map((r) => [r.where, r.status]), [['Row 2', 'Name matches'], ['Row 3', 'Name matches']]);

  await panel.selectOption('#tab-pick', '1');
  assert.match(await panel.textContent('#message'), /Couldn't find an account number column/);

  await panel.selectOption('#tab-pick', 'all');
  await settled();
  const rows = await rowsShown(panel);
  assert.deepEqual(rows.map((r) => r.where), ['Sales · Row 2', 'Ops · Row 2', 'Ops · Row 3']);
  assert.match(rows[0].text, /Same account as Ops row 2/);

  const [download] = await Promise.all([panel.waitForEvent('download'), panel.click('#download')]);
  const csv = (await readFile(await download.path(), 'utf8')).split('\r\n');
  assert.match(csv[0], /^"Tab","Row"/);
  assert.match(csv[1], /^"Sales","2"/);
});

test('a filter picked on one sheet does not carry over to the next file', async () => {
  const { panel } = await ext.openPanelFor('https://docs.google.com/spreadsheets/d/TESTSHEET/edit#gid=0');
  await runCheck(panel);
  await panel.getByRole('button', { name: /^Different name/ }).click();
  const XLSX = await import('../../src/vendor/xlsx.mjs');
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Name', 'Bank', 'Account'], ['Femi Ade', 'UBA', validNumber('033', '0')]]), 'Pay');
  await panel.setInputFiles('#file', { name: 'Pay.xlsx', mimeType: 'application/octet-stream', buffer: XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) });
  await panel.waitForFunction(() => document.getElementById('sheet-title').textContent === 'Pay.xlsx'
    && document.getElementById('progress').hidden && ![...document.querySelectorAll('.pill')].some((p) => p.textContent === 'Checking'));
  assert.match(await panel.textContent('.chip[aria-pressed="true"]'), /^Needs attention 1/);
  assert.deepEqual((await rowsShown(panel)).map((r) => r.status), ['Not at this bank']);
});
