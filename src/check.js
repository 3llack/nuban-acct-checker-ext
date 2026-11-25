import { cleanAccountNumber, passesNuban } from './nuban.js';
import { findBank, banksThatFit } from './banks.js';

export function fitsNote(account, bank) {
  const fits = banksThatFit(account, bank);
  if (!fits.length) return 'The number does not fit any of the main commercial banks either (it may be a fintech or microfinance account)';
  return `The number could be ${fits.join(', ')}`;
}

export function prepareRows(table, cols, { dedupe = true } = {}) {
  const out = [];
  for (let r = cols.headerRow + 1; r < table.length; r++) {
    const row = table[r] ?? [];
    const cell = (i) => (i >= 0 ? String(row[i] ?? '').trim() : '');
    const name = cell(cols.name);
    const rawAccount = cell(cols.account);
    const rawBank = cell(cols.bank);
    if (!rawAccount && (!name || /^(sub\s*)?total/i.test(name))) continue;

    const entry = { row: r + 1, name, rawAccount, rawBank, notes: [], status: 'lookup' };
    out.push(entry);

    const bank = findBank(rawBank);
    const acct = cleanAccountNumber(rawAccount, bank);
    if (!bank && rawAccount) {
      entry.status = 'no-bank';
      entry.detail = rawBank ? `"${rawBank}" is not a bank we know yet` : 'No bank given';
      if (acct.ok) entry.account = acct.value; else entry.notes.push(acct.reason);
      continue;
    }
    if (!acct.ok) { entry.status = 'invalid'; entry.detail = acct.reason; continue; }
    entry.account = acct.value;
    entry.notes.push(...acct.notes);
    entry.bank = bank;
    if (bank.closed) { entry.status = 'closed'; entry.detail = bank.closed; continue; }
    if (bank.nibss && !passesNuban(entry.account, bank.nibss)) {
      entry.status = 'check-digit';
      entry.detail = `Not a valid ${bank.name} account number`;
      entry.notes.push(fitsNote(entry.account, bank));
    }
  }

  return dedupe ? markDuplicates(out) : out;
}

export function markDuplicates(entries, where = (e) => `row ${e.row}`) {
  const seen = new Map();
  for (const e of entries) {
    if (!e.account) continue;
    const key = `${e.account}|${e.bank?.code ?? e.rawBank.toLowerCase()}`;
    if (seen.has(key)) {
      const first = seen.get(key);
      e.notes.push(`Same account as ${where(first)}`);
      if (!first.notes.some((n) => n.startsWith('Same account'))) first.notes.push(`Same account as ${where(e)}`);
    } else seen.set(key, e);
  }
  return entries;
}
