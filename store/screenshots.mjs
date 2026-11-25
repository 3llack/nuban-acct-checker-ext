import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { launch, runCheck, validNumber, root } from '../tests/e2e/helpers.js';

const out = path.join(root, 'store', 'images');
await mkdir(out, { recursive: true });

const rows = [
  ['Adaeze Okafor', 'GTBank', validNumber('058', '5', 18013855)],
  ['Tunde Bakare', 'Zenith Bank', validNumber('057', '7', 12296750)],
  ['Ngozi Eze', 'Access', validNumber('044', '1', 56881543)],
  ['Chinedu Obi', 'First Bank', validNumber('011', '2', 41029068)],
  ['Fatima Bello', 'UBA', validNumber('033', '0', 33277160)],
  ['Emeka Nwosu', 'Fidelity', '1234567890'],
  ['Kemi Adeyemi', 'Sterling', validNumber('232', '4', 60046732)],
  ['Segun Alabi', 'Wema Bank', '20345678'],
  ['Halima Yusuf', 'Stanbic IBTC', validNumber('221', '3', 89746194)],
];
const csv = ['Staff name,Bank,Account number,Net pay', ...rows.map(([n, b, a], i) => `${n},${b},${a},${(185000 + i * 12500).toLocaleString('en-NG')}`)].join('\n');

const settled = (panel) => panel.waitForFunction(() => document.getElementById('progress').hidden
  && ![...document.querySelectorAll('.pill')].some((p) => p.textContent === 'Checking'));

const ext = await launch({ sheetCsv: csv });
const panelShot = async (panel, file) => {
  await panel.evaluate(() => { document.getElementById('demo-badge').hidden = true; window.scrollTo(0, 0); });
  await panel.setViewportSize({ width: 400, height: 760 });
  await panel.screenshot({ path: path.join(out, file) });
};

const { panel } = await ext.openPanelFor('https://docs.google.com/spreadsheets/d/DEMO/edit#gid=0');
await runCheck(panel);
await panelShot(panel, 'panel-results.png');
await panel.getByRole('button', { name: /^Different name/ }).click();
await panelShot(panel, 'panel-filter.png');
const XLSX = await import('../src/vendor/xlsx.mjs');
const wb = XLSX.utils.book_new();
const head = ['Name', 'Bank', 'Account Number'];
const bisi = validNumber('058', '6', 37692350);
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([head, ['Bisi Ojo', 'GTBank', bisi], ['Musa Danjuma', 'UBA', validNumber('033', '8', 29364568)]]), 'Head office');
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([head, ['Ifeoma Nnaji', 'Zenith', validNumber('057', '9', 96493285)], ['Bisi Ojo', 'GTB', bisi], ['Yemi Lawal', 'Access', validNumber('044', '0', 58224018)]]), 'Lagos branch');
const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
await panel.setInputFiles('#file', { name: 'December payroll.xlsx', mimeType: 'application/octet-stream', buffer });
await panel.locator('#tab-pick-wrap').waitFor();
await panel.selectOption('#tab-pick', 'all');
await settled(panel);
await panel.getByRole('button', { name: /^All / }).click();
await panelShot(panel, 'panel-tabs.png');
await ext.context.close();

const icon = (await readFile(path.join(root, 'icons', 'icon-128.png'))).toString('base64');
const img = async (f) => `data:image/png;base64,${(await readFile(path.join(out, f))).toString('base64')}`;
const frames = [
  ['screenshot-1.png', 'panel-results.png', 'Check every account before you pay', 'Open your salary sheet, click once, and see which account numbers match the bank and the person.'],
  ['screenshot-2.png', 'panel-filter.png', 'See only what needs fixing', 'Wrong names, wrong banks and mistyped numbers are flagged, with the row to jump to.'],
  ['screenshot-3.png', 'panel-tabs.png', 'Google Sheets, Excel or CSV', 'Check one tab or all of them. The same account paid twice across tabs is flagged too.'],
];
const browser = await chromium.launch();
const page = await browser.newPage();
const style = `*{box-sizing:border-box}body{margin:0;font-family:system-ui,sans-serif;background:#f6f3ec;color:#14261c}`;
for (const [file, shot, title, text] of frames) {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.setContent(`<style>${style}
    .wrap{display:flex;align-items:center;gap:72px;height:800px;padding:0 96px}
    .copy{flex:1}.copy img{width:64px;height:64px;border-radius:14px}
    h1{font-size:46px;line-height:1.1;margin:28px 0 18px}p{font-size:22px;line-height:1.45;color:#5b6a61;margin:0}
    .shot{width:400px;height:760px;border-radius:14px;box-shadow:0 18px 50px rgba(20,38,28,.18);border:1px solid #ddd7ca}
  </style><div class="wrap"><div class="copy"><img src="data:image/png;base64,${icon}"><h1>${title}</h1><p>${text}</p></div><img class="shot" src="${await img(shot)}"></div>`);
  await page.screenshot({ path: path.join(out, file) });
}
await page.setViewportSize({ width: 440, height: 280 });
await page.setContent(`<style>${style}body{background:#1f6b45;color:#fff}
  .t{display:flex;flex-direction:column;justify-content:center;height:280px;padding:0 36px}
  img{width:56px;height:56px;border-radius:12px;background:#fff}h1{font-size:34px;margin:18px 0 8px}p{font-size:17px;margin:0;opacity:.9}
</style><div class="t"><img src="data:image/png;base64,${icon}"><h1>Account Checker</h1><p>Check salary account numbers before you pay.</p></div>`);
await page.screenshot({ path: path.join(out, 'promo-small.png') });
await browser.close();
console.log('Images written to store/images');
