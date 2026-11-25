const TIMEOUT_MS = 15_000;

async function getJson(url, init = {}) {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  let body = null;
  try { body = await res.json(); } catch { }
  return { status: res.status, body };
}

export function paystackProvider({ key, base = 'https://api.paystack.co' }) {
  const call = (path) => getJson(`${base}${path}`, { headers: { authorization: `Bearer ${key}` } });
  return {
    name: 'paystack',
    async resolve(account, bank) {
      const { status, body } = await call(`/bank/resolve?account_number=${account}&bank_code=${bank}`);
      if (status === 200 && body?.status && body.data?.account_name) return { kind: 'found', name: body.data.account_name };
      if (/test mode|daily limit/i.test(body?.message || '')) return { kind: 'error', status, error: 'busy', testLimit: true };
      if (status === 422 || status === 400 || status === 404) return { kind: 'missing' };
      if (status === 429) return { kind: 'error', status, error: 'busy', testLimit: /test mode/i.test(body?.message || '') };
      return { kind: 'error', status, error: 'provider error' };
    },
    async banks() {
      const { status, body } = await call('/bank?country=nigeria&perPage=500');
      if (status !== 200 || !Array.isArray(body?.data)) return null;
      return body.data.filter((b) => b.active !== false).map((b) => ({ name: b.name, code: b.code }));
    },
  };
}

export const MONNIFY_CODES = {
  '999991': '100033',
  '565': '940',
  '107': '00107',
  '104': '907',
  '106': '000034',
};

export function monnifyProvider({ apiKey, secretKey, base = 'https://api.monnify.com' }) {
  let token = null, expires = 0, pending = null;

  async function login() {
    const basic = Buffer.from(`${apiKey}:${secretKey}`).toString('base64');
    const { status, body } = await getJson(`${base}/api/v1/auth/login`, { method: 'POST', headers: { authorization: `Basic ${basic}` } });
    if (status !== 200 || !body?.requestSuccessful || !body.responseBody?.accessToken) return null;
    token = body.responseBody.accessToken;
    expires = Date.now() + Math.max(60, Number(body.responseBody.expiresIn || 3600) - 60) * 1000;
    return token;
  }

  function ensureToken() {
    if (token && Date.now() < expires) return token;
    pending ??= login().finally(() => { pending = null; });
    return pending;
  }

  async function authed(path, retry = true) {
    if (!(await ensureToken())) return { status: 401, body: null };
    const res = await getJson(`${base}${path}`, { headers: { authorization: `Bearer ${token}` } });
    if (res.status === 401 && retry) { token = null; return authed(path, false); }
    return res;
  }

  return {
    name: 'monnify',
    async check() {
      token = null;
      return Boolean(await ensureToken());
    },
    async resolve(account, bank) {
      const code = MONNIFY_CODES[bank] || bank;
      const { status, body } = await authed(`/api/v2/disbursements/account/validate?accountNumber=${account}&bankCode=${code}`);
      const name = body?.responseBody?.accountName?.trim();
      if (status === 200 && body?.requestSuccessful && name) return { kind: 'found', name };
      const message = String(body?.responseMessage || '');
      if (status >= 400 && status < 500 && ![401, 403, 429].includes(status) && !/unavailable|timeout|try again|could not be validated/i.test(message)) {
        return { kind: 'missing' };
      }
      return { kind: 'error', status, error: status === 401 ? 'login failed' : 'provider error' };
    },
  };
}
