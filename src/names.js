const TITLES = new Set(['mr', 'mrs', 'miss', 'ms', 'dr', 'engr', 'prof', 'chief', 'alh', 'alhaji', 'alhaja', 'hajia', 'pastor', 'barr', 'sir']);

function tokens(name) {
  return String(name ?? '').toLowerCase().replace(/[^a-z\s-]/g, ' ').replace(/-/g, ' ')
    .split(/\s+/).filter((t) => t && !TITLES.has(t));
}

function oneEditApart(a, b) {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (a.length > b.length) i++;
    else if (b.length > a.length) j++;
    else { i++; j++; }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

function same(a, b) {
  if (a === b) return true;
  if (a.length === 1 || b.length === 1) return a[0] === b[0];
  return a.length >= 5 && b.length >= 5 && oneEditApart(a, b);
}

export function compareNames(sheetName, bankName) {
  const sheet = tokens(sheetName);
  const bank = tokens(bankName);
  if (!sheet.length || !bank.length) return 'mismatch';
  const unused = [...bank];
  let full = 0, matched = 0;
  for (const s of sheet) {
    const idx = unused.findIndex((b) => same(s, b));
    if (idx === -1) continue;
    matched++;
    if (s.length > 1 && unused[idx].length > 1) full++;
    unused.splice(idx, 1);
  }
  const shorter = Math.min(sheet.length, bank.length);
  if (full >= Math.min(2, shorter) && matched === shorter) return 'match';
  if (full >= 1) return 'partial';
  return 'mismatch';
}
