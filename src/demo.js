export async function demoResolve(account, sheetName) {
  await new Promise((r) => setTimeout(r, 150 + Math.random() * 250));
  const parts = String(sheetName || 'Demo Person').toUpperCase().split(/\s+/).filter(Boolean);
  switch (account.at(-1)) {
    case '0': return { found: false };
    case '1': return { found: true, accountName: 'ADEYEMI CHIOMA BELLO' };
    case '2': return { found: true, accountName: [parts[0], 'IBRAHIM'].join(' ') };
    default: return { found: true, accountName: [...parts.slice(1), parts[0]].join(' ') };
  }
}
