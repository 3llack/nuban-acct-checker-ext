import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { paystackProvider, monnifyProvider } from './providers.js';

const DAY = 24 * 60 * 60 * 1000;

export function createServer({
  paystackKey,
  paystackBase = 'https://api.paystack.co',
  monnify = null,
  allowedOrigins = ['chrome-extension://*'],
  perMinute = 120,
  perDay = 1000,
  globalPerDay = 20000,
  requireOrigin = false,
  trustProxy = false,
  retryDelay = 1000,
  log = (line) => console.log(line),
  order = ['monnify', 'paystack'],
}) {
  const rank = (name) => (order.includes(name) ? order.indexOf(name) : order.length);
  const providers = [
    paystackKey && paystackProvider({ key: paystackKey, base: paystackBase }),
    monnify?.apiKey && monnify?.secretKey && monnifyProvider(monnify),
  ].filter(Boolean).sort((a, b) => rank(a.name) - rank(b.name));
  if (!providers.length) throw new Error('Set PAYSTACK_SECRET_KEY, or MONNIFY_API_KEY and MONNIFY_SECRET_KEY');
  const bankSource = providers.find((p) => p.banks);
  const usage = new Map();
  const total = { dayStart: Date.now(), day: 0 };
  let bankCache = null;
  const prune = setInterval(() => {
    const now = Date.now();
    for (const [ip, u] of usage) if (now - u.dayStart > DAY) usage.delete(ip);
  }, 10 * 60_000);
  prune.unref();

  function allowOrigin(origin) {
    if (!origin) return null;
    return allowedOrigins.some((o) => o === origin || (o.endsWith('*') && origin.startsWith(o.slice(0, -1)))) ? origin : null;
  }

  function clientIp(req) {
    if (trustProxy) {
      const edge = req.headers['cf-connecting-ip'] || req.headers['true-client-ip'];
      if (edge) return String(edge).trim();
      const first = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
      if (first) return first;
    }
    return req.socket.remoteAddress;
  }

  function overLimit(ip) {
    const now = Date.now();
    if (now - total.dayStart > DAY) { total.dayStart = now; total.day = 0; }
    if (total.day >= globalPerDay) return { scope: 'day', retryAfter: Math.ceil((total.dayStart + DAY - now) / 1000) };
    let u = usage.get(ip);
    if (!u || now - u.dayStart > DAY) { u = { minuteStart: now, minute: 0, dayStart: now, day: 0 }; usage.set(ip, u); }
    if (now - u.minuteStart > 60_000) { u.minuteStart = now; u.minute = 0; }
    if (u.day >= perDay) return { scope: 'day', retryAfter: Math.ceil((u.dayStart + DAY - now) / 1000) };
    if (u.minute >= perMinute) return { scope: 'minute', retryAfter: Math.max(1, Math.ceil((u.minuteStart + 60_000 - now) / 1000)) };
    u.minute++; u.day++; total.day++;
    return null;
  }

  async function resolve(input, note) {
    const account = String(input?.account_number ?? '');
    const bank = String(input?.bank_code ?? '');
    if (!/^\d{10}$/.test(account) || !/^\d{3,6}$/.test(bank)) return [400, { error: 'account_number must be 10 digits and bank_code 3 to 6 digits' }];
    const ask = async (p) => { try { return await p.resolve(account, bank); } catch { return { kind: 'error', error: 'unreachable' }; } };
    let testLimit = false, missingFrom = null, errors = 0;
    for (const p of providers) {
      let r = await ask(p);
      let retried = false;
      if (r.kind === 'missing' && !missingFrom) {
        await new Promise((ok) => setTimeout(ok, retryDelay));
        const again = await ask(p);
        retried = true;
        if (again.kind !== 'error') r = again;
      }
      if (r.kind === 'found') {
        note(`${p.name}${retried ? ' after retry' : ''}`);
        return [200, { found: true, account_name: r.name }];
      }
      if (r.kind === 'missing') { missingFrom ??= p.name; continue; }
      testLimit ||= Boolean(r.testLimit);
      errors++;
    }
    if (missingFrom) {
      note(`${missingFrom} (not found)`);
      return [200, { found: false }];
    }
    note('none');
    if (testLimit && errors === 1) {
      return [503, { error: 'Paystack test mode allows 3 real lookups a day. Use the live key.' }];
    }
    return [503, { error: 'The bank lookup is busy or down. Try again shortly.' }];
  }

  async function banks() {
    if (bankCache && Date.now() - bankCache.at < DAY) return [200, bankCache.list];
    const list = bankSource && await bankSource.banks();
    if (!list) return [502, { error: 'Could not load bank list' }];
    bankCache = { at: Date.now(), list };
    return [200, list];
  }

  function readJson(req) {
    return new Promise((ok, fail) => {
      let size = 0, data = '';
      req.on('data', (chunk) => { size += chunk.length; if (size > 2048) { fail(new Error('too large')); req.destroy(); } else data += chunk; });
      req.on('end', () => { try { ok(JSON.parse(data || '{}')); } catch { fail(new Error('bad json')); } });
      req.on('error', fail);
    });
  }

  const server = http.createServer(async (req, res) => {
    const started = Date.now();
    const origin = allowOrigin(req.headers.origin);
    let via = '';
    const send = (status, body, extra = {}) => {
      const headers = { 'content-type': 'application/json', 'cache-control': 'no-store', ...extra };
      if (origin) Object.assign(headers, { 'access-control-allow-origin': origin, vary: 'Origin' });
      res.writeHead(status, headers).end(JSON.stringify(body));
      if (req.url !== '/health') log(`${req.method} ${req.url.split('?')[0]} ${status} ${Date.now() - started}ms${via ? ` via ${via}` : ''}`);
    };
    try {
      if (req.method === 'OPTIONS') {
        res.writeHead(204, origin ? {
          'access-control-allow-origin': origin,
          'access-control-allow-methods': 'GET, POST',
          'access-control-allow-headers': 'content-type',
          'access-control-max-age': '600',
          vary: 'Origin',
        } : {}).end();
        return;
      }
      const path = req.url.split('?')[0];
      if (req.method === 'GET' && path === '/health') return send(200, { ok: true });
      if (req.method === 'GET' && path === '/banks') return send(...await banks());
      if (req.method === 'POST' && path === '/resolve') {
        if (requireOrigin && !origin) return send(403, { error: 'Not allowed' });
        const limited = overLimit(clientIp(req));
        if (limited) {
          const error = limited.scope === 'minute' ? 'Too many lookups at once' : 'Daily lookup limit reached';
          return send(429, { error, scope: limited.scope, retry_after: limited.retryAfter }, { 'retry-after': String(limited.retryAfter) });
        }
        let input;
        try { input = await readJson(req); } catch { return send(400, { error: 'Send JSON: { account_number, bank_code }' }); }
        return send(...await resolve(input, (name) => { via = name; }));
      }
      send(404, { error: 'Not found' });
    } catch {
      send(502, { error: 'Lookup provider unreachable' });
    }
  });
  server.on('close', () => clearInterval(prune));
  server.checkProviders = async () => Promise.all(providers.map(async (p) => {
    if (!p.check) return `${p.name}: key set`;
    try { return `${p.name}: ${(await p.check()) ? 'login ok' : 'LOGIN FAILED, check the keys match the base URL'}`; } catch { return `${p.name}: unreachable at startup`; }
  }));
  return server;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const port = Number(process.env.PORT || 8787);
  const server = createServer({
    paystackKey: process.env.PAYSTACK_SECRET_KEY,
    monnify: {
      apiKey: process.env.MONNIFY_API_KEY,
      secretKey: process.env.MONNIFY_SECRET_KEY,
      base: process.env.MONNIFY_BASE_URL || 'https://api.monnify.com',
    },
    allowedOrigins: (process.env.ALLOWED_ORIGINS || 'chrome-extension://*').split(',').map((s) => s.trim()),
    perMinute: Number(process.env.LIMIT_PER_MINUTE || 120),
    perDay: Number(process.env.LIMIT_PER_DAY || 1000),
    globalPerDay: Number(process.env.LIMIT_GLOBAL_PER_DAY || 20000),
    requireOrigin: process.env.REQUIRE_ORIGIN !== '0',
    trustProxy: process.env.TRUST_PROXY === '1',
    order: process.env.LOOKUP_ORDER ? process.env.LOOKUP_ORDER.split(',').map((s) => s.trim()) : undefined,
  });
  server.on('error', (err) => {
    if (err.code !== 'EADDRINUSE') throw err;
    console.error(`Port ${port} is already in use. The backend is probably already running in another terminal; use that one, or close it and start again.`);
    process.exit(1);
  });
  server.listen(port, () => {
    console.log(`Account Checker backend on http://localhost:${port}`);
    server.checkProviders().then((lines) => lines.forEach((l) => console.log(l)));
  });
  const stop = () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 10_000).unref();
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}
