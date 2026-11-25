import { parseCsv } from './csv.js';

export function parseTabList(html) {
  const tabs = [];
  const re = /items\.push\(\{name:\s*"((?:[^"\\]|\\.)*)"[^}]*?gid:\s*"(-?\d+)"/g;
  for (const m of String(html).matchAll(re)) tabs.push({ name: unescapeJs(m[1]), gid: m[2] });
  return tabs;
}

function unescapeJs(s) {
  try { return JSON.parse(`"${s.replace(/\\x([0-9a-f]{2})/gi, '\\u00$1').replace(/\\\//g, '/')}"`); } catch { return s; }
}

export const FILE_TYPES = '.xlsx,.xlsm,.xls,.ods,.csv';

export async function readWorkbookFile(file) {
  if (/\.csv$/i.test(file.name) || file.type === 'text/csv') return [{ name: file.name, table: parseCsv(await file.text()) }];
  if (!/\.(xlsx|xlsm|xls|ods)$/i.test(file.name)) throw new Error('Use an Excel (.xlsx, .xls), OpenDocument (.ods) or CSV file.');
  const XLSX = await import('./vendor/xlsx.mjs');
  const wb = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: false });
  const hidden = new Set((wb.Workbook?.Sheets || []).filter((s) => s.Hidden).map((s) => s.name));
  return wb.SheetNames.filter((n) => !hidden.has(n)).map((name) => ({ name, table: tableFromSheet(XLSX, wb.Sheets[name]) }));
}

export function tableFromSheet(XLSX, ws) {
  if (!ws?.['!ref']) return [];
  const range = XLSX.utils.decode_range(ws['!ref']);
  const table = [];
  for (let r = 0; r <= range.e.r; r++) {
    const row = [];
    for (let c = 0; c <= range.e.c; c++) {
      const cell = r >= range.s.r && c >= range.s.c ? ws[XLSX.utils.encode_cell({ r, c })] : null;
      row.push(cellText(cell));
    }
    table.push(row);
  }
  return table;
}

function cellText(cell) {
  if (!cell || cell.v == null) return '';
  if (cell.t === 'n' && Number.isInteger(cell.v) && (cell.w == null || /e[+-]/i.test(cell.w))) return String(cell.v);
  return cell.w ?? String(cell.v);
}
