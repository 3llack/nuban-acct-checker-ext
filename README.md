# Account Checker

A Chrome extension that checks the account numbers in a salary sheet before you pay. For each row it tells you whether the account exists at the stated bank and whether the name on it matches the name in your sheet.

Built by [266Labs](https://266labs.com). Nigeria only for now.

## What it does

- Reads a Google Sheet open in the current tab, or an Excel (.xlsx, .xls, .xlsm), OpenDocument (.ods) or CSV file dropped into the panel.
- Finds the name, account number and bank columns by itself. You can change them.
- Checks every visible tab, one at a time or all together.
- Runs free checks first, in the browser:
  - cleans up account numbers, including spaces, dashes, `1.2E+09`, and leading zeros lost by Excel;
  - checks that the bank name is recognised;
  - runs the NUBAN check digit;
  - finds duplicate accounts, including across tabs.
- Looks up each remaining account and compares the bank's name with the sheet's, ignoring word order, initials and middle names.
- Shows a status for each row: Name matches, Partly matches, Different name, Not at this bank, Wrong for this bank, Invalid number, Bank closed, Can't check.
- Click a row to jump to it in the sheet. "Copy status column" copies the statuses so you can paste them into the sheet yourself. "Download results" saves a CSV.

The extension never writes to or changes your sheet or file.

## Privacy

- Sheets and files are read in the browser. Files are never uploaded.
- Only the account number and bank code of each row are sent to the backend. Names, amounts and every other column stay in the browser.
- The backend stores and logs no account numbers or names.
- Closing the panel clears everything.

Full policy: https://266labs.com/account-checker/privacy (source in `store/privacy.html`).

## How it fits together

```
Extension (side panel)  ->  Backend (server/, on Render)  ->  Monnify, then Paystack as backup
```

- **Extension** (`manifest.json`, `src/`): Manifest V3 and plain JavaScript, with no build step. It needs the `sidePanel` and `scripting` permissions, plus access to `docs.google.com/spreadsheets/*` and `*.googleusercontent.com/*`, where Google serves sheet exports. SheetJS is bundled in `src/vendor/` (Apache-2.0).
- **Backend** (`server/`): plain Node 22 with no dependencies. It holds the provider keys, so they never sit in the extension.
- **Lookups**: Monnify first, then Paystack if Monnify can't answer. A "not found" is asked again after a second, and then of the other provider, before it is reported, because a slow bank can give the same answer as a wrong number.

## Run it locally

1. `npm install` (only needed for the browser tests).
2. Copy `server/.env.example` to `server/.env` and fill in the keys (see [Backend settings](#backend-settings)).
3. `npm run server` starts the backend on http://localhost:8787. The first log lines say whether each provider works, for example `monnify: login ok`.
4. In `src/config.js`, set `BACKEND_URL = 'http://localhost:8787'`. Don't commit this.
5. In Chrome, open `chrome://extensions`, turn on Developer mode, choose Load unpacked and select this folder.

With `BACKEND_URL` empty, the extension runs in demo mode: results are made up and a "Demo data" badge shows.

## Backend

| Route | |
| --- | --- |
| `POST /resolve` | `{ account_number, bank_code }` returns `{ found: true, account_name }` or `{ found: false }` |
| `GET /health` | `{ ok: true }` |
| `GET /banks` | Paystack's list of Nigerian banks |

### Backend settings

| Variable | Default | |
| --- | --- | --- |
| `MONNIFY_API_KEY`, `MONNIFY_SECRET_KEY` | | Monnify dashboard > Developers |
| `MONNIFY_BASE_URL` | `https://api.monnify.com` | Use `https://sandbox.monnify.com` with sandbox keys |
| `PAYSTACK_SECRET_KEY` | | Optional backup. Paystack dashboard > Settings > API Keys |
| `LOOKUP_ORDER` | `monnify,paystack` | Which provider is asked first |
| `ALLOWED_ORIGINS` | `chrome-extension://*` | Set to the store extension's `chrome-extension://<id>` |
| `REQUIRE_ORIGIN` | `1` | `/resolve` refuses requests without an allowed origin; set `0` only to test with curl |
| `LIMIT_PER_MINUTE` | `120` | Per caller address |
| `LIMIT_PER_DAY` | `1000` | Per caller address |
| `LIMIT_GLOBAL_PER_DAY` | `20000` | Across everyone |
| `TRUST_PROXY` | `0` | `1` behind Render, so the caller address comes from Cloudflare's headers |
| `PORT` | `8787` | Render sets this itself |

At least one provider's keys must be set. When the per-minute limit is hit, the server says how long to wait, and the extension waits and carries on. Only a daily limit shows as an error.

## Deploy the backend (Render)

1. Push this repo. In Render, choose New > Blueprint and pick the repo. `render.yaml` sets up the service: no build step, start command `node server/server.js`, health check `/health`.
2. Enter `MONNIFY_API_KEY`, `MONNIFY_SECRET_KEY` and `PAYSTACK_SECRET_KEY` when Render asks. Keys only ever go into Render's dashboard. Production currently runs on Monnify's sandbox keys (`render.yaml` sets the sandbox URL), with Paystack's live key as the backup. Moving to live Monnify keys means also changing `MONNIFY_BASE_URL` to `https://api.monnify.com`.
3. After it deploys, check that the log shows `monnify: login ok`.
4. Put the service URL (for example `https://account-checker-backend.onrender.com`) in `BACKEND_URL` in `src/config.js`, then commit and push. Only changes to `server/` or `render.yaml` redeploy the backend.

The free plan sleeps after 15 idle minutes, so the first check after a quiet spell can take about a minute. The extension waits up to 90 seconds.

## Release to the Chrome Web Store

1. `npm run pack` builds `dist/account-checker-<version>.zip`. It refuses to build in demo mode or with a localhost `BACKEND_URL`.
2. Follow `store/CHROMEWEBSTORE.md`. It has the listing text, the reasons for each permission, the privacy answers and the steps for reviewers. Screenshots are in `store/images` (`npm run screenshots` regenerates them).
3. After the first upload, set `ALLOWED_ORIGINS` on Render to `chrome-extension://<extension ID>`.
4. For updates, raise `version` in `manifest.json`, then run `npm run pack` and upload again.

## Tests

- `npm test` covers the logic (account cleanup, NUBAN, banks, name matching, columns, files) and the backend against fake Monnify and Paystack servers.
- `npm run test:e2e` loads the extension in Playwright's Chromium against a fake Google Sheet and drives the panel end to end, including through the real backend. Set `HEADED=1` to watch.
