import { mkdtemp, mkdir, cp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { passesNuban } from '../../src/nuban.js';

export const root = path.resolve(fileURLToPath(import.meta.url), '../../..');
export const shots = path.join(root, 'test-results');

export function validNumber(nibss, last, start = 1) {
  for (let n = start; ; n++) {
    const acct = String(n).padStart(9, '0') + last;
    if (passesNuban(acct, nibss)) return acct;
  }
}

export async function extensionCopy(backendUrl = '') {
  const extDir = await mkdtemp(path.join(tmpdir(), 'acct-ext-'));
  await cp(path.join(root, 'manifest.json'), path.join(extDir, 'manifest.json'));
  await cp(path.join(root, 'src'), path.join(extDir, 'src'), { recursive: true });
  await cp(path.join(root, 'icons'), path.join(extDir, 'icons'), { recursive: true });
  await writeFile(path.join(extDir, 'src', 'config.js'), `export const BACKEND_URL = ${JSON.stringify(backendUrl)};\n`);
  return extDir;
}

export async function launch({ sheetCsv, backendUrl }) {
  await mkdir(shots, { recursive: true });
  const extDir = await extensionCopy(backendUrl);
  const state = { exportStatus: 200, csv: sheetCsv, tabs: null };
  const csvFor = (url) => state.tabs?.find((t) => t.gid === new URL(url).searchParams.get('gid'))?.csv ?? state.csv;
  const context = await chromium.launchPersistentContext(await mkdtemp(path.join(tmpdir(), 'acct-e2e-')), {
    channel: 'chromium',
    headless: !process.env.HEADED,
    args: [`--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`],
    viewport: { width: 400, height: 900 },
  });
  await context.route('https://docs.google.com/**', (route) => {
    const url = route.request().url();
    if (url.includes('/export')) {
      return state.exportStatus === 200
        ? route.fulfill({ status: 200, contentType: 'text/csv', body: csvFor(url) })
        : route.fulfill({ status: state.exportStatus, contentType: 'text/html', body: '<html>denied</html>' });
    }
    if (url.includes('/gviz/')) return route.fulfill({ status: 200, contentType: 'text/csv', body: csvFor(url) });
    if (url.includes('/htmlview') && state.tabs) {
      const items = state.tabs.map((t) => `items.push({name: ${JSON.stringify(t.name)}, pageUrl: "x", gid: "${t.gid}",initialSheet: false});`).join('');
      return route.fulfill({ status: 200, contentType: 'text/html', body: `<script>var items = [];${items}</script>` });
    }
    return route.fulfill({ status: 200, contentType: 'text/html', body: '<title>November salary - Google Sheets</title><canvas></canvas>' });
  });
  await context.route('https://example.com/**', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<title>Not a sheet</title>' }));
  const sw = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
  const extId = new URL(sw.url()).host;

  async function openPanelFor(url) {
    const listIds = () => sw.evaluate(async () => (await chrome.tabs.query({})).map((t) => t.id));
    const before = new Set(await listIds());
    const tab = await context.newPage();
    await tab.goto(url);
    const tabId = (await listIds()).find((id) => !before.has(id));
    const panel = await context.newPage();
    await panel.goto(`chrome-extension://${extId}/src/panel.html?tab=${tabId}`);
    return { tab, panel };
  }

  return { context, sw, extId, state, openPanelFor };
}

export async function runCheck(panel) {
  await panel.click('#check');
  await panel.locator('#results').waitFor();
  await panel.waitForFunction(() => document.getElementById('progress').hidden
    && ![...document.querySelectorAll('.pill')].some((p) => p.textContent === 'Checking'));
}

export async function showAll(panel) {
  await panel.getByRole('button', { name: /^All / }).click();
}

export async function rowsShown(panel) {
  return panel.$$eval('#list li:not(.empty)', (lis) => lis.map((li) => ({
    row: Number(li.querySelector('.row-num').textContent.match(/Row (\d+)/)[1]),
    where: li.querySelector('.row-num').textContent,
    status: li.querySelector('.pill').textContent,
    text: li.textContent,
  })));
}
