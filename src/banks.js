import { passesNuban } from './nuban.js';

export const BANKS = [
  { name: 'Access Bank', code: '044', nibss: '044', aliases: ['access', 'access diamond'] },
  { name: 'Citibank', code: '023', nibss: '023', aliases: ['citi', 'citibank'] },
  { name: 'Ecobank', code: '050', nibss: '050', aliases: ['eco', 'ecobank'] },
  { name: 'Fidelity Bank', code: '070', nibss: '070', aliases: ['fidelity'] },
  { name: 'First Bank', code: '011', nibss: '011', aliases: ['first', 'firstbank', 'fbn', 'first bank of nigeria'] },
  { name: 'FCMB', code: '214', nibss: '214', aliases: ['fcmb', 'first city monument'] },
  { name: 'GTBank', code: '058', nibss: '058', aliases: ['gt', 'gtb', 'gtbank', 'gtco', 'guaranty trust'] },
  { name: 'Heritage Bank', code: '030', nibss: '030', aliases: ['heritage'], closed: 'Heritage Bank lost its licence in June 2024. Ask for a new account.' },
  { name: 'Keystone Bank', code: '082', nibss: '082', aliases: ['keystone'] },
  { name: 'Polaris Bank', code: '076', nibss: '076', aliases: ['polaris', 'skye'] },
  { name: 'Stanbic IBTC', code: '221', nibss: '221', aliases: ['stanbic', 'stanbic ibtc', 'ibtc'] },
  { name: 'Sterling Bank', code: '232', nibss: '232', aliases: ['sterling'] },
  { name: 'Union Bank', code: '032', nibss: '032', aliases: ['union'] },
  { name: 'UBA', code: '033', nibss: '033', aliases: ['uba', 'united for africa'] },
  { name: 'Unity Bank', code: '215', nibss: '215', aliases: ['unity'] },
  { name: 'Wema Bank', code: '035', nibss: '035', aliases: ['wema', 'alat'] },
  { name: 'Zenith Bank', code: '057', nibss: '057', aliases: ['zenith'] },
  { name: 'Providus Bank', code: '101', nibss: null, aliases: ['providus'] },
  { name: 'Jaiz Bank', code: '301', nibss: null, aliases: ['jaiz'] },
  { name: 'Kuda', code: '50211', nibss: null, aliases: ['kuda'] },
  { name: 'OPay', code: '999992', nibss: null, aliases: ['opay', 'paycom'], phoneBased: true },
  { name: 'PalmPay', code: '999991', nibss: null, aliases: ['palmpay', 'palm pay'], phoneBased: true },
  { name: 'Moniepoint', code: '50515', nibss: null, aliases: ['moniepoint', 'teamapt'] },
  { name: 'Carbon', code: '565', nibss: null, aliases: ['carbon'] },
  { name: 'FairMoney', code: '51318', nibss: null, aliases: ['fairmoney', 'fair money'] },
  { name: 'Globus Bank', code: '00103', nibss: null, aliases: ['globus'] },
  { name: 'Lotus Bank', code: '303', nibss: null, aliases: ['lotus'] },
  { name: 'Optimus Bank', code: '107', nibss: null, aliases: ['optimus'] },
  { name: 'Parallex Bank', code: '104', nibss: null, aliases: ['parallex'] },
  { name: 'PremiumTrust Bank', code: '105', nibss: null, aliases: ['premiumtrust', 'premium trust'] },
  { name: 'Signature Bank', code: '106', nibss: null, aliases: ['signature'] },
  { name: 'Suntrust Bank', code: '100', nibss: null, aliases: ['suntrust', 'sun trust'] },
  { name: 'TAJ Bank', code: '302', nibss: null, aliases: ['taj', 'tajbank'] },
  { name: 'Titan Trust Bank', code: '102', nibss: null, aliases: ['titan', 'titan trust'] },
  { name: 'VFD Microfinance Bank', code: '566', nibss: null, aliases: ['vfd', 'vbank'] },
];

const FILLER = new Set(['bank', 'plc', 'ltd', 'limited', 'nigeria', 'of', 'the', 'mfb', 'microfinance', 'for']);

function normalise(text) {
  return String(text ?? '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ')
    .split(/\s+/).filter((w) => w && !FILLER.has(w)).join(' ');
}

const LOOKUP = new Map();
for (const bank of BANKS) {
  for (const key of [bank.name, bank.code, ...bank.aliases]) {
    LOOKUP.set(normalise(key), bank);
    LOOKUP.set(normalise(key).replace(/ /g, ''), bank);
  }
}

export function banksThatFit(account, except) {
  return BANKS.filter((b) => b.nibss && !b.closed && b !== except && passesNuban(account, b.nibss)).map((b) => b.name);
}

export function findBank(text) {
  const key = normalise(text);
  if (!key) return null;
  return LOOKUP.get(key) ?? LOOKUP.get(key.replace(/ /g, '')) ?? null;
}
