import { parseCsv } from './csv.js';
import { detectColumns, columnLetter } from './columns.js';
import { prepareRows, markDuplicates, fitsNote } from './check.js';
import { compareNames } from './names.js';
import { resolveAccount, isDemo } from './lookup.js';
import { parseTabList, readWorkbookFile, FILE_TYPES } from './workbook.js';
import { SITE_URL, TIPS_URL } from './links.js';

const STATUS = {
  match: { label: 'Name matches', tone: 'good' },
  found: { label: 'Account found', tone: 'good' },
  partial: { label: 'Partly matches', tone: 'warn' },
  mismatch: { label: 'Different name', tone: 'bad' },
  'not-found': { label: 'Not at this bank', tone: 'bad' },
  closed: { label: 'Bank closed', tone: 'bad' },
  invalid: { label: 'Invalid number', tone: 'bad' },
  'check-digit': { label: 'Wrong for this bank', tone: 'bad' },
  'no-bank': { label: "Can't check", tone: 'skip' },
  error: { label: 'Lookup failed', tone: 'skip' },
  lookup: { label: 'Checking', tone: 'skip' },
};
const CONCURRENCY = 4;
const MAX_TABS = 30;

const $ = (id) => document.getElementById(id);

let book = null;
let entries = [];
let filter = 'attention';
let runId = 0;

$('demo-badge').hidden = !isDemo();
$('site-link').href = SITE_URL;
if (TIPS_URL) { $('tips-link').href = TIPS_URL; $('tips-link').hidden = false; }
$('check').addEventListener('click', checkSheet);
$('copy').addEventListener('click', copyStatusColumn);
$('download').addEventListener('click', downloadResults);
$('tab-pick').addEventListener('change', () => {
  book.view = $('tab-pick').value === 'all' ? 'all' : Number($('tab-pick').value);
  fillPickers();
  runChecks();
});
for (const select of document.querySelectorAll('select[data-col]')) {
  select.addEventListener('change', () => {
    book.tabs[book.view].cols[select.dataset.col] = Number(select.value);
    fillTabPicker();
    runChecks();
  });
}

$('file').accept = FILE_TYPES;
$('file').addEventListener('change', () => { if ($('file').files[0]) loadFile($('file').files[0]); $('file').value = ''; });
document.addEventListener('dragover', (ev) => { ev.preventDefault(); $('drop').classList.add('over'); });
document.addEventListener('dragleave', (ev) => { if (!ev.relatedTarget) $('drop').classList.remove('over'); });
document.addEventListener('drop', (ev) => {
  ev.preventDefault();
  $('drop').classList.remove('over');
  const file = ev.dataTransfer?.files?.[0];
  if (file) loadFile(file);
});

async function fetchText(url) {
  try {
    const res = await fetch(url, { credentials: 'include' });
    if (!res.ok) return null;
    return { text: await res.text(), html: /text\/html/.test(res.headers.get('content-type') || '') };
  } catch { return null; }
}

async function listTabs(id) {
  const res = await fetchText(`https://docs.google.com/spreadsheets/d/${id}/htmlview`);
  return res?.html ? parseTabList(res.text).slice(0, MAX_TABS) : [];
}

async function readTab(tabId, id, gid) {
  const res = await fetchText(`https://docs.google.com/spreadsheets/d/${id}/export?format=csv&gid=${gid}`);
  if (res && !res.html) return { text: res.text, source: 'export' };
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    func: async (u) => {
      try {
        const r = await fetch(u, { credentials: 'include' });
        return r.ok && !/text\/html/.test(r.headers.get('content-type') || '') ? await r.text() : null;
      } catch { return null; }
    },
    args: [`/spreadsheets/d/${id}/gviz/tq?tqx=out:csv&headers=0&gid=${gid}`],
  });
  return result != null ? { text: result, source: 'gviz' } : null;
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i]); }
  }));
  return out;
}

const needsAttention = (e) => !['match', 'found', 'lookup'].includes(e.status);

async function targetTab() {
  const forced = Number(new URLSearchParams(location.search).get('tab'));
  if (forced) return chrome.tabs.get(forced);
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function checkSheet() {
  showMessage('');
  const tab = await targetTab();
  const match = tab?.url?.match(/^https:\/\/docs\.google\.com\/spreadsheets\/d\/([^/?#]+)/);
  if (!match) return showMessage('Open your salary sheet in Google Sheets and click Check this sheet, or drop an Excel or CSV file below.');
  if (/[?&]rtpof=true/.test(tab.url)) {
    return showMessage('This is an Excel file opened in Google Sheets. Use File > Save as Google Sheets and check the new copy, or download the file and drop it below.');
  }
  const id = match[1];
  const gid = (tab.url.match(/[#&?]gid=(-?\d+)/) || [])[1] || '0';

  $('check').disabled = true;
  $('check').textContent = 'Reading sheet...';
  try {
    let list = await listTabs(id);
    if (!list.some((t) => t.gid === gid)) list = [{ name: list.length ? 'This tab' : null, gid }, ...list];
    let gviz = false;
    const tabs = await mapLimit(list, CONCURRENCY, async (t) => {
      const res = await readTab(tab.id, id, t.gid);
      if (!res) return { ...t, failed: true, table: [] };
      if (res.source === 'gviz') gviz = true;
      let table = parseCsv(res.text);
      if (res.source === 'gviz' && table[0]?.every((c) => !c.trim())) table = table.slice(1);
      return { ...t, table };
    });
    const current = tabs.findIndex((t) => t.gid === gid);
    if (tabs[current].failed) return showMessage("Couldn't read this sheet. Make sure you are signed in and can open it, then try again.");
    document.body.dataset.source = gviz ? 'gviz' : 'export';
    openBook({
      kind: 'google', tabId: tab.id, url: tab.url.split('#')[0], tabs, view: current,
      title: (tab.title || '').replace(/ - Google Sheets$/, '') || 'Google Sheet',
      warning: gviz ? 'Read in limited mode: some cells (like account numbers typed as text) may show as missing. Reload the extension and check again.' : '',
    });
  } catch (err) {
    showMessage(`Couldn't read this sheet (${err.message}). Reload the sheet tab and try again.`);
  } finally {
    $('check').disabled = false;
    $('check').textContent = 'Check again';
  }
}

async function loadFile(file) {
  showMessage('');
  try {
    const tabs = await readWorkbookFile(file);
    if (!tabs.length) return showMessage('This file has no sheets to read.');
    document.body.dataset.source = 'file';
    const withAccounts = tabs.findIndex((t) => detectColumns(t.table).account >= 0);
    openBook({ kind: 'file', tabs, view: Math.max(withAccounts, 0), title: file.name, warning: '' });
    $('check').textContent = 'Check this sheet';
  } catch (err) {
    showMessage(`Couldn't read ${file.name}: ${err.message}`);
  }
}

function openBook(next) {
  for (const t of next.tabs) t.cols = detectColumns(t.table);
  book = { ...next, cache: new Map() };
  filter = 'attention';
  $('sheet-title').textContent = book.title;
  fillTabPicker();
  fillPickers();
  runChecks();
}

const isAll = () => book.view === 'all';
const scopeTabs = () => (isAll() ? book.tabs.filter((t) => !t.failed && t.cols.account >= 0) : [book.tabs[book.view]]);

function fillTabPicker() {
  const usable = book.tabs.filter((t) => !t.failed && t.cols.account >= 0).length;
  $('tab-pick-wrap').hidden = book.tabs.length < 2;
  const options = book.tabs.map((t, i) => {
    const note = t.failed ? " (couldn't read)" : t.cols.account < 0 ? ' (no account column)' : '';
    const o = new Option(`${t.name || `Tab ${i + 1}`}${note}`, String(i));
    o.disabled = !!t.failed;
    return o;
  });
  if (usable > 1) options.unshift(new Option(`All tabs (${usable})`, 'all'));
  $('tab-pick').replaceChildren(...options);
  $('tab-pick').value = String(book.view);
}

function fillPickers() {
  $('columns').hidden = false;
  $('pickers').hidden = isAll();
  $('pickers-hint').hidden = !isAll();
  if (isAll()) return;
  const { cols } = book.tabs[book.view];
  for (const select of document.querySelectorAll('select[data-col]')) {
    const key = select.dataset.col;
    select.replaceChildren(new Option('(none)', '-1'),
      ...cols.headers.map((h, i) => new Option(`${columnLetter(i)}: ${h || 'untitled'}`, String(i))));
    select.value = String(cols[key]);
  }
}

async function runChecks() {
  const id = ++runId;
  showMessage(book.warning, 'warn');
  if (!isAll() && book.tabs[book.view].cols.account < 0) {
    entries = [];
    $('results').hidden = true;
    return showMessage("Couldn't find an account number column. Pick it under Columns.");
  }
  const scope = scopeTabs();
  entries = scope.flatMap((t) => prepareRows(t.table, t.cols, { dedupe: false }).map((e) => Object.assign(e, { tab: t })));
  markDuplicates(entries, (e) => (scope.length > 1 ? `${tabName(e.tab)} row ${e.row}` : `row ${e.row}`));
  $('results').hidden = false;
  $('copy-hint').hidden = true;
  $('copy').disabled = scope.length > 1;
  $('copy').title = scope.length > 1 ? 'Pick a single tab to copy its status column' : '';
  render();

  const { cache } = book;
  const queue = entries.filter((e) => e.status === 'lookup');
  let done = 0;
  const total = queue.length;
  setProgress(total ? 0 : 1);

  async function worker() {
    while (queue.length && id === runId) {
      const e = queue.shift();
      const key = `${e.account}|${e.bank.code}`;
      try {
        if (!cache.has(key)) cache.set(key, resolveAccount(e.account, e.bank.code, e.name));
        const res = await cache.get(key);
        if (id !== runId) return;
        if (!res.found) {
          e.status = 'not-found';
          e.detail = `No ${e.bank.name} account has this number`;
          e.notes.push(fitsNote(e.account, e.bank));
        } else {
          e.accountName = res.accountName;
          e.status = e.name ? compareNames(e.name, res.accountName) : 'found';
        }
      } catch (err) {
        cache.delete(key);
        if (id !== runId) return;
        e.status = 'error';
        e.detail = err.message;
      }
      setProgress(++done / total);
      render();
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
}

const tabName = (t) => t.name || `Tab ${book.tabs.indexOf(t) + 1}`;

function setProgress(fraction) {
  $('progress-bar').style.width = `${Math.round(fraction * 100)}%`;
  $('progress').hidden = fraction >= 1;
}

function render() {
  const counts = {};
  for (const e of entries) counts[e.status] = (counts[e.status] || 0) + 1;
  const attention = entries.filter(needsAttention).length;
  if (!['all', 'attention'].includes(filter) && !counts[filter] && !counts.lookup) filter = 'attention';

  const chips = [
    ['attention', `Needs attention ${attention}`, attention ? 'bad' : 'good'],
    ['all', `All ${entries.length}`, 'skip'],
    ...Object.keys(STATUS).filter((s) => counts[s]).map((s) => [s, `${STATUS[s].label} ${counts[s]}`, STATUS[s].tone]),
  ];
  $('chips').replaceChildren(...chips.map(([key, text, tone]) => {
    const b = document.createElement('button');
    b.className = `chip ${tone}`;
    b.textContent = text;
    b.setAttribute('aria-pressed', String(filter === key));
    b.addEventListener('click', () => { filter = key; render(); });
    return b;
  }));

  const shown = entries.filter((e) => filter === 'all' ? true
    : filter === 'attention' ? needsAttention(e) || e.status === 'lookup' : e.status === filter);
  const list = shown.length ? shown.map(renderEntry) : [emptyItem()];
  $('list').replaceChildren(...list);
}

function renderEntry(e) {
  const li = document.createElement('li');
  if (book.kind === 'google') {
    li.title = 'Show this row in the sheet';
    li.addEventListener('click', () => jumpTo(e));
  } else {
    li.className = 'no-jump';
  }
  const top = el('div', 'row-top');
  top.append(el('span', 'who', e.name || '(no name)'), pill(e.status));
  const where = isAll() && scopeTabs().length > 1 ? `${tabName(e.tab)} · Row ${e.row}` : `Row ${e.row}`;
  li.append(el('div', 'row-num', where), top,
    el('div', 'acct', [e.account || e.rawAccount || 'no number', e.bank?.name || e.rawBank].filter(Boolean).join(' · ')));
  if (e.accountName) li.append(el('div', 'bank-name', `Bank says: ${e.accountName}`));
  if (e.detail) li.append(el('div', 'note', e.detail));
  for (const n of e.notes) li.append(el('div', 'note', n));
  return li;
}

function emptyItem() {
  const done = entries.length && entries.every((e) => e.status !== 'lookup');
  return el('li', 'empty', done ? 'Nothing needs attention. Every account checks out.' : 'No rows here yet.');
}

function pill(status) {
  const s = STATUS[status];
  return el('span', `pill ${s.tone}`, s.label);
}

function el(tag, cls, text) {
  const node = document.createElement(tag);
  node.className = cls;
  if (text != null) node.textContent = text;
  return node;
}

function jumpTo(e) {
  const col = columnLetter(Math.max(e.tab.cols.account, 0));
  chrome.tabs.update(book.tabId, { url: `${book.url}#gid=${e.tab.gid}&range=${col}${e.row}`, active: true });
}

function statusText(e) {
  const label = STATUS[e.status].label;
  if (['mismatch', 'partial', 'found'].includes(e.status)) return `${label}: ${e.accountName}`;
  if (e.detail && e.status !== 'not-found') return `${label}: ${e.detail}`;
  return label;
}

async function copyStatusColumn() {
  const { cols } = book.tabs[book.view];
  const byRow = new Map(entries.map((e) => [e.row, e]));
  const first = cols.headerRow + 1;
  const start = Math.max(first, 1);
  const last = Math.max(start, ...entries.map((e) => e.row));
  const lines = [];
  for (let r = start; r <= last; r++) {
    if (r === first) lines.push('Account check');
    else lines.push(byRow.has(r) ? statusText(byRow.get(r)) : '');
  }
  await navigator.clipboard.writeText(lines.join('\n'));
  $('copy-hint').textContent = `Copied. In the sheet, click row ${start} of an empty column and paste.`;
  $('copy-hint').hidden = false;
}

function downloadResults() {
  const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const withTab = book.tabs.length > 1;
  const header = [...(withTab ? ['Tab'] : []), 'Row', 'Name on sheet', 'Account number', 'Bank', 'Result', 'Name at bank', 'Notes'];
  const rows = entries.map((e) => [...(withTab ? [tabName(e.tab)] : []), e.row, e.name, e.account || e.rawAccount,
    e.bank?.name || e.rawBank, STATUS[e.status].label, e.accountName, [e.detail, ...e.notes].filter(Boolean).join('; ')]);
  const csv = [header, ...rows].map((r) => r.map(q).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: 'account-check.csv' });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function showMessage(text, tone = 'bad') {
  $('message').textContent = text;
  $('message').className = `message ${tone}`;
  $('message').hidden = !text;
}
