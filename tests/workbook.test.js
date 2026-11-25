import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from '../src/vendor/xlsx.mjs';
import { parseTabList, readWorkbookFile } from '../src/workbook.js';
import { prepareRows, markDuplicates } from '../src/check.js';
import { detectColumns } from '../src/columns.js';

test('reads the tab list from Google htmlview, including escaped names', () => {
  const html = 'var items = [];items.push({name: "Class Data", pageUrl: "https:\\/\\/docs.google.com\\/x?headers\\x3dtrue&gid=0", gid: "0",initialSheet: ("0" == gid)});'
    + 'items.push({name: "Staff \\x26 Contractors", pageUrl: "x", gid: "1874530199",initialSheet: false});';
  assert.deepEqual(parseTabList(html), [{ name: 'Class Data', gid: '0' }, { name: 'Staff & Contractors', gid: '1874530199' }]);
  assert.deepEqual(parseTabList('<html>no tabs</html>'), []);
});

function workbookFile() {
  const ws = XLSX.utils.aoa_to_sheet([
    ['Name', 'Bank', 'Account Number'],
    ['Ada Obi', 'GTB', 8138438059],
    ['Bo Eze', 'Stanbic', '0034010120'],
    ['Cy Musa', 'Access', 34010120],
    ['Di Bello', 'Zenith', 1234567890],
  ], { origin: 'A3' });
  ws.C6.z = '0000000000';
  ws.C7.z = '0.00E+00';
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Staff');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['secret']]), 'Hidden');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Notes'], ['pay on the 25th']]), 'Notes');
  wb.Workbook = { Sheets: [{ Hidden: 0 }, { Hidden: 1 }, { Hidden: 0 }] };
  return new File([XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })], 'November.xlsx');
}

test('reads an Excel file: visible tabs, row numbers as in the file, numbers as shown', async () => {
  const tabs = await readWorkbookFile(workbookFile());
  assert.deepEqual(tabs.map((t) => t.name), ['Staff', 'Notes']);
  const staff = tabs[0].table;
  assert.deepEqual(staff[0], ['', '', '']);
  assert.deepEqual(staff[2], ['Name', 'Bank', 'Account Number']);
  assert.equal(staff[3][2], '8138438059');
  assert.equal(staff[4][2], '0034010120');
  assert.equal(staff[5][2], '0034010120');
  assert.equal(staff[6][2], '1234567890');
  const cols = detectColumns(staff);
  assert.equal(cols.headerRow, 2);
  assert.deepEqual(prepareRows(staff, cols).map((e) => e.row), [4, 5, 6, 7]);
});

test('reads a CSV file as text so leading zeros survive', async () => {
  const tabs = await readWorkbookFile(new File(['Name,Bank,Account Number\nBo Eze,Stanbic,0034010120\n'], 'pay.csv'));
  assert.equal(tabs.length, 1);
  assert.equal(tabs[0].table[1][2], '0034010120');
});

test('refuses files that are not spreadsheets', async () => {
  await assert.rejects(readWorkbookFile(new File(['x'], 'photo.png')), /Excel/);
});

test('flags the same account across tabs with the tab name', () => {
  const cols = { headerRow: 0, name: 0, account: 2, bank: 1 };
  const a = prepareRows([['Name', 'Bank', 'Acct'], ['Ada', 'GTB', '0000000018']], cols, { dedupe: false }).map((e) => ({ ...e, tab: 'Sales' }));
  const b = prepareRows([['Name', 'Bank', 'Acct'], ['Ada', 'GTBank', '0000000018']], cols, { dedupe: false }).map((e) => ({ ...e, tab: 'Ops' }));
  const all = markDuplicates([...a, ...b], (e) => `${e.tab} row ${e.row}`);
  assert.deepEqual(all.map((e) => e.notes), [['Same account as Ops row 2'], ['Same account as Sales row 2']]);
});
