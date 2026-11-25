const WEIGHTS = [3, 7, 3, 3, 7, 3, 3, 7, 3, 3, 7, 3];

export function passesNuban(account, nibssCode) {
  if (!/^\d{10}$/.test(account) || !/^\d{3}$/.test(nibssCode)) return false;
  const digits = (nibssCode + account.slice(0, 9)).split('').map(Number);
  const sum = digits.reduce((total, d, i) => total + d * WEIGHTS[i], 0);
  return (10 - (sum % 10)) % 10 === Number(account[9]);
}

const FIX_COLUMN = 'Format the account number column as Plain text (Format > Number > Plain text) and retype it.';

export function cleanAccountNumber(raw, bank = null) {
  const text = String(raw ?? '').normalize('NFKC').replace(/[​-‍⁠﻿]/g, '')
    .trim().replace(/^'/, '');
  if (!text) return { ok: false, reason: 'No account number' };
  if (/^\d+(\.\d+)?e\+?\d+$/i.test(text.replace(/,/g, ''))) {
    return { ok: false, reason: `Shown as a short number (like 1.2E+09), so digits are lost. ${FIX_COLUMN}` };
  }

  const notes = [];
  let digits;
  const plain = text.replace(/\.0+$/, '');
  if (/^[\d\s,\-./]+$/.test(plain)) {
    if (plain.split(/\D+/).filter((g) => g.length >= 8).length > 1) return { ok: false, reason: 'More than one number in this cell' };
    digits = plain.replace(/\D/g, '');
  } else {
    const runs = text.match(/\d{8,}/g) || [];
    if (runs.length > 1) return { ok: false, reason: 'More than one number in this cell' };
    if (!runs.length) return { ok: false, reason: 'No account number in this cell' };
    digits = runs[0];
    notes.push('Ignored the text around the number');
  }

  if (digits.length === 10) return { ok: true, value: digits, notes };

  if (digits.length === 11 && digits[0] === '0') {
    if (bank?.phoneBased) {
      notes.push(`Used the phone number without its first 0 (${bank.name} account numbers are the phone number)`);
      return { ok: true, value: digits.slice(1), notes };
    }
    return { ok: false, reason: 'Has 11 digits; looks like a phone number, not an account number' };
  }

  if (digits.length === 8 || digits.length === 9) {
    const padded = digits.padStart(10, '0');
    const missing = 10 - digits.length;
    const zeros = missing === 1 ? 'Leading zero was missing' : 'Leading zeros were missing';
    if (bank?.nibss) {
      if (passesNuban(padded, bank.nibss)) {
        notes.push(`${zeros}; put back (the number then checks out for ${bank.name}). ${FIX_COLUMN}`);
        return { ok: true, value: padded, notes };
      }
      return { ok: false, reason: `Has ${digits.length} digits, needs 10. Adding leading zeros does not make a valid ${bank.name} number either.` };
    }
    if (missing === 1) {
      notes.push(`${zeros}; put back. The lookup will confirm it. ${FIX_COLUMN}`);
      return { ok: true, value: padded, notes };
    }
  }
  return { ok: false, reason: `Has ${digits.length} digits, needs 10` };
}
