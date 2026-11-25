import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv } from '../src/csv.js';
import { cleanAccountNumber, passesNuban } from '../src/nuban.js';
import { findBank } from '../src/banks.js';
import { compareNames } from '../src/names.js';
import { detectColumns } from '../src/columns.js';
import { prepareRows } from '../src/check.js';

test('csv handles quotes, commas and CRLF', () => {
  assert.deepEqual(parseCsv('a,"b, c","d ""q"""\r\n1,2,3\n'), [['a', 'b, c', 'd "q"'], ['1', '2', '3']]);
});

test('NUBAN check digit (CBN worked example: bank 011, serial 000001457, check 9)', () => {
  assert.equal(passesNuban('0000014579', '011'), true);
  assert.equal(passesNuban('0000014578', '011'), false);
  assert.equal(passesNuban('0000000018', '058'), true);
});

test('bank names as HR types them', () => {
  for (const t of ['GTB', 'GTBank Plc', 'Guaranty Trust Bank', 'gt bank', '058']) assert.equal(findBank(t)?.code, '058', t);
  assert.equal(findBank('First Bank of Nigeria')?.code, '011');
  assert.equal(findBank('UBA')?.code, '033');
  assert.equal(findBank('Opay')?.code, '999992');
  assert.equal(findBank('Moniepoint MFB')?.code, '50515');
  assert.equal(findBank('Nowhere Bank'), null);
});

test('name comparison', () => {
  assert.equal(compareNames('Chioma Adeyemi', 'ADEYEMI CHIOMA'), 'match');
  assert.equal(compareNames('Chioma Adeyemi', 'ADEYEMI CHIOMA BLESSING'), 'match');
  assert.equal(compareNames('Mrs Chioma B. Adeyemi', 'ADEYEMI CHIOMA BLESSING'), 'match');
  assert.equal(compareNames('Oluwaseun Bakare', 'BAKARE OLUWASEUN'), 'match');
  assert.equal(compareNames('Oluwasegun Bakare', 'BAKARE OLUWASEUN'), 'match');
  assert.equal(compareNames('Chioma Adeyemi', 'ADEYEMI IBRAHIM'), 'partial');
  assert.equal(compareNames('Chioma Adeyemi', 'MUSA IBRAHIM'), 'mismatch');
});

test('finds columns from headers below a title row', () => {
  const table = parseCsv('November salary,,,\nS/N,Staff Name,Bank Name,Account No.,Net Pay\n1,Ada Obi,GTB,0000000018,250000\n');
  const cols = detectColumns(table);
  assert.deepEqual([cols.headerRow, cols.name, cols.bank, cols.account], [1, 1, 2, 3]);
});

test('guesses columns when there is no header', () => {
  const cols = detectColumns(parseCsv('Ada Obi,GTB,0000000018\nMusa Bello,Zenith,1234567890\n'));
  assert.deepEqual([cols.headerRow, cols.name, cols.bank, cols.account], [-1, 0, 1, 2]);
});

test('prepares rows: free checks, duplicates, skipped totals', () => {
  const table = parseCsv([
    'Name,Bank,Account Number',
    'Ada Obi,GTB,0000000018',
    'Bad Digit,GTB,0000000017',
    'Short,GTB,12345',
    'Unknown,Nowhere Bank,0000000018',
    'Ada Again,GTBank,0000000018',
    'Kuda Person,Kuda,1234567890',
    ',,',
    'Total,,',
  ].join('\n'));
  const rows = prepareRows(table, detectColumns(table));
  assert.deepEqual(rows.map((r) => [r.row, r.status]), [
    [2, 'lookup'], [3, 'check-digit'], [4, 'invalid'], [5, 'no-bank'], [6, 'lookup'], [7, 'lookup'],
  ]);
  assert.match(rows[0].notes[0], /row 6/);
  assert.match(rows[4].notes[0], /row 2/);
});

test('suggests banks a wrong number fits', async () => {
  const { fitsNote } = await import('../src/check.js');
  const { findBank } = await import('../src/banks.js');
  assert.match(fitsNote('0000014579', findBank('GTB')), /First Bank/);
});

test('closed banks are flagged before any lookup, newer banks are recognised', () => {
  const table = parseCsv('Name,Bank,Account Number\nOld Account,Heritage Bank,0000000018\n');
  const [row] = prepareRows(table, detectColumns(table));
  assert.equal(row.status, 'closed');
  for (const [text, code] of [['Globus Bank', '00103'], ['FairMoney MFB', '51318'], ['VFD', '566'], ['Titan Trust', '102'], ['PremiumTrust Bank Ltd', '105']]) {
    assert.equal(findBank(text)?.code, code, text);
  }
});

test('account number edge cases', () => {
  const gtb = findBank('GTB'), stanbic = findBank('Stanbic'), opay = findBank('OPay'), kuda = findBank('Kuda');
  const ok = (raw, bank, value, note) => {
    const r = cleanAccountNumber(raw, bank);
    assert.equal(r.ok, true, `${raw}: ${r.reason}`);
    assert.equal(r.value, value, raw);
    if (note) assert.match(r.notes.join(' '), note, raw); else assert.deepEqual(r.notes, [], raw);
  };
  const bad = (raw, bank, reason) => {
    const r = cleanAccountNumber(raw, bank);
    assert.equal(r.ok, false, `${raw} should fail`);
    assert.match(r.reason, reason, raw);
  };
  ok('0012345688', gtb, '0012345688');
  ok(" '0012345688 ", gtb, '0012345688');
  ok('0012-345-688', gtb, '0012345688');
  ok('0012 345 688', gtb, '0012345688');
  ok('1,234,567,890', null, '1234567890');
  ok('0012345688.0', gtb, '0012345688');
  ok('0012345688\u00a0', gtb, '0012345688');
  ok('\u200b0012345688', gtb, '0012345688');
  ok('００１２３４５６８８', gtb, '0012345688');
  ok('12345688', gtb, '0012345688', /Leading zeros were missing/);
  ok('40000005', stanbic, '0040000005', /Leading zeros were missing/);
  bad('12345689', gtb, /does not make a valid GTBank number/);
  ok('123456789', kuda, '0123456789', /lookup will confirm/);
  bad('12345678', kuda, /Has 8 digits/);
  bad('12345678', null, /Has 8 digits/);
  ok('08012345678', opay, '8012345678', /phone number/);
  bad('08012345678', gtb, /looks like a phone number/);
  ok('GTB 0012345688', gtb, '0012345688', /Ignored the text/);
  ok('Acct: 0012345688', gtb, '0012345688', /Ignored the text/);
  bad('0012345688 / 0023456871', gtb, /More than one number/);
  bad('pending', gtb, /No account number in this cell/);
  bad('1.23457E+09', gtb, /short number/);
  bad('8.13844E+9', opay, /short number/);
  bad('12345', gtb, /Has 5 digits/);
  bad('123456789012', gtb, /Has 12 digits/);
  bad('', gtb, /No account number/);
});

test('owner sheet from 19 Nov: number column dropped zeros, one number typed as text', () => {
  const table = parseCsv([
    'Name,Bank,Account Number',
    'Ada Obi,GTB,12345688',
    'Musa Ibrahim,Zenith Bank,23456871',
    'Bad Digit,GTBank,12345689',
    'Too Short,GTB,12345',
    'Old Account,Heritage Bank,56789044',
    'Odd Bank,Nowhere Bank,12345688',
    'Typed As Text,Stanbic IBTC,0040000005',
    'Phone Number,OPAY,08012345678',
  ].join('\n'));
  const cols = detectColumns(table);
  assert.deepEqual([cols.headerRow, cols.name, cols.bank, cols.account], [0, 0, 1, 2]);
  const rows = prepareRows(table, cols);
  assert.deepEqual(rows.map((r) => [r.row, r.status, r.account]), [
    [2, 'lookup', '0012345688'],
    [3, 'lookup', '0023456871'],
    [4, 'invalid', undefined],
    [5, 'invalid', undefined],
    [6, 'closed', '0056789044'],
    [7, 'no-bank', undefined],
    [8, 'lookup', '0040000005'],
    [9, 'lookup', '8012345678'],
  ]);
});

test('a header row we cannot name is still treated as a header', () => {
  const cols = detectColumns(parseCsv('Staff,Where paid,Digits\nAda Obi,GTB,12345688\nMusa Bello,Zenith,0023456871\n'));
  assert.deepEqual([cols.headerRow, cols.name, cols.bank, cols.account], [0, 0, 1, 2]);
  assert.deepEqual(cols.headers, ['Staff', 'Where paid', 'Digits']);
});

test('more header spellings', () => {
  for (const h of ['Account No', 'Acct No.', 'A/C Number', 'Account Nos', 'NUBAN', 'Bank Account', 'Account']) {
    const cols = detectColumns(parseCsv(`Name,Bank,${h}\nAda Obi,GTB,0012345688\n`));
    assert.equal(cols.account, 2, h);
  }
  assert.equal(detectColumns(parseCsv('Account Name,Bank,Account Number\nAda,GTB,0012345688\n')).name, 0);
});
