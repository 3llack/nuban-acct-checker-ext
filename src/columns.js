import { findBank } from './banks.js';

const ACCOUNT_HEADER = /(account|acct|a\/c|acc)\.?\s*(no|nos|number|num|#)\b|nuban|^\s*(bank\s+)?(account|acct|a\/c)s?\s*$/i;
const BANK_HEADER = /bank/i;
const NAME_HEADER = /name|employee|staff|beneficiary/i;

export function detectColumns(table) {
  const scan = Math.min(table.length, 15);
  for (let r = 0; r < scan; r++) {
    const row = table[r].map((c) => c.trim());
    const account = row.findIndex((c) => ACCOUNT_HEADER.test(c));
    if (account === -1) continue;
    const bank = row.findIndex((c, i) => i !== account && BANK_HEADER.test(c) && !ACCOUNT_HEADER.test(c));
    const name = row.findIndex((c, i) => i !== account && i !== bank && NAME_HEADER.test(c) && !BANK_HEADER.test(c));
    return { headerRow: r, account, name, bank, headers: row };
  }
  return guessFromData(table);
}

function guessFromData(table) {
  const width = Math.max(0, ...table.map((r) => r.length));
  const first = (table[0] || []).map((c) => c.trim());
  const isHeader = first.filter(Boolean).length >= 2 && !first.some((c) => /\d{6,}/.test(c));
  const score = { account: new Array(width).fill(0), bank: new Array(width).fill(0), name: new Array(width).fill(0) };
  for (const row of table.slice(isHeader ? 1 : 0, 200)) {
    row.forEach((cell, i) => {
      const c = cell.trim();
      if (/^\d{8,11}$/.test(c.replace(/[\s,.-]/g, ''))) score.account[i]++;
      else if (findBank(c)) score.bank[i]++;
      else if (/^[a-z.'-]+(\s+[a-z.'-]+)+$/i.test(c)) score.name[i]++;
    });
  }
  const best = (arr) => { const max = Math.max(0, ...arr); return max ? arr.indexOf(max) : -1; };
  const headers = Array.from({ length: width }, (_, i) => (isHeader && first[i]) || `Column ${columnLetter(i)}`);
  return { headerRow: isHeader ? 0 : -1, account: best(score.account), name: best(score.name), bank: best(score.bank), headers };
}

export function columnLetter(index) {
  let n = index + 1, s = '';
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
}
