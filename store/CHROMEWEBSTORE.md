# Chrome Web Store submission

Everything to paste into the Chrome Web Store developer dashboard, in the order the dashboard asks for it.

## Before you submit

1. **Get a live Monnify key.** The Monnify sandbox does real lookups, but it is meant for testing and could be capped or switched off without warning. A live Paystack key is optional, since Paystack is only the backup.
2. **Host the backend on Render.** `render.yaml` sets it up. Then set `BACKEND_URL` in `src/config.js` to the Render https address and commit it.
3. **Build the zip.** Run `npm run pack` to get `dist/account-checker-<version>.zip`. The script refuses to build while the extension is in demo mode or points at localhost.
4. **Push the 266labs site.** The privacy policy is built as a page there, at `https://266labs.com/account-checker/privacy` (committed in the 266labs repo, not pushed yet). If you change one copy, change the other: this repo has `store/privacy.html`.
5. **Upload the zip as a draft** to get the extension's ID.
6. **Lock the backend to the extension.** On Render, set `ALLOWED_ORIGINS=chrome-extension://<that ID>` so that only this extension can use the backend. The default allows every extension.
7. **Register as a developer.** It's a one-time US$5 fee. Verify the contact email, and turn on 2-step verification on the Google account.

## Store listing

**Name** (from the manifest): Account Checker

**Summary** (from the manifest, 132 characters max):
Check that each account number in your salary sheet belongs to the right bank and person before you pay.

**Description:**

```
Paying salaries from a spreadsheet? Check every account first.

Account Checker reads your salary sheet and checks each Nigerian account number against the bank. It tells you, row by row, whether the account exists at that bank and whether the name on it matches the name in your sheet. Catch typos, wrong banks and wrong people before the money goes out.

How it works
1. Open your salary sheet in Google Sheets, or drop an Excel or CSV file into the panel.
2. Click "Check this sheet".
3. See which rows need attention. Click a row to jump to it in your sheet.

What it catches
- Account numbers that don't exist at the stated bank
- Names that don't match the account holder, or only partly match
- Numbers that fail the bank's check digit, or are too short
- Leading zeros lost by Excel, restored when the number is otherwise valid
- The same account appearing twice, including across tabs
- Unknown or misspelt bank names

Works with
- Google Sheets, including sheets with several tabs
- Excel (.xlsx, .xls), OpenDocument (.ods) and CSV files
- 30+ Nigerian banks and fintechs, including OPay, PalmPay, Kuda and Moniepoint

Your data stays yours
- Read only: it never changes or writes to your sheet or file.
- Only the account number and bank code are sent for the lookup. Names and amounts never leave your browser.
- Nothing is stored or logged. Closing the panel clears everything.

You can copy a status column to paste back into your sheet yourself, or download the results.

Built by 266Labs.
```

**Category:** Productivity > Workflow & Planning. Use the closest equivalent if the dashboard labels differ.

**Language:** English

**Images** (in `store/images`; regenerate with `node store/screenshots.mjs`):
- Store icon: use `icons/icon-128.png`.
- Screenshots (1280x800): `screenshot-1.png`, `screenshot-2.png`, `screenshot-3.png`. All names and numbers in them are made up.
- Small promo tile (440x280): `promo-small.png`.

**Website:** https://266labs.com
**Support email:** hello@266labs.com

## Privacy practices tab

**Single purpose:**
Checks that the bank account numbers in a salary sheet or file belong to the stated bank and person, before the user makes payments.

**Permission justifications:**

| Permission | Justification |
| --- | --- |
| `sidePanel` | The checker runs in Chrome's side panel, so the user can see the results next to their sheet. |
| `scripting` | This is a backup way to read the open Google Sheet when Google blocks the normal export. It runs a read-only fetch of the sheet's data in that tab, and only when the user clicks Check. Nothing is changed on the page. |
| Host `https://docs.google.com/spreadsheets/*` | Reads the Google Sheet the user has open, including its list of tabs, using the user's own sign-in. Read only, and only when the user clicks Check. |
| Host `https://*.googleusercontent.com/*` | Google sends sheet exports from this domain, so reading the sheet needs it. Nothing else on it is accessed. |

**Remote code:** No, I am not using remote code. All code is in the package. The spreadsheet reader (SheetJS) is bundled, not loaded from the web.

**Data usage.** Tick these:
- **Financial and payment information.** Bank account numbers and bank codes are sent to our lookup service to check them.
- **Personally identifiable information.** The account holder's name is returned by the bank lookup and passes through our service to the extension.

Leave everything else unticked. Health, authentication, personal communications, location, web history, user activity and website content are not collected. The sheet is read in the browser, and only account numbers and bank codes leave it.

**Certify all three:**
- not sold or transferred to third parties, outside the approved use cases;
- not used or transferred for purposes unrelated to the single purpose;
- not used or transferred to determine creditworthiness or for lending.

**Privacy policy URL:** https://266labs.com/account-checker/privacy

## Distribution

- **Visibility:** Public. To try it with a few people first, use Unlisted, which only works through the direct link.
- **Regions:** Nigeria only for now. The lookups only cover Nigerian banks.

## Test instructions for the reviewer

Paste these into the "Test instructions" field:

```
1. Pin the extension and click its icon to open the side panel.
2. Click "Choose a file" in the panel and pick any spreadsheet with columns for name, bank and a 10-digit Nigerian account number. Or open such a sheet in Google Sheets and click "Check this sheet".
3. Each row gets a status: Name matches, Partly matches, Different name, Not at this bank, Invalid number, and so on.
Lookups run against live Nigerian bank data, so made-up numbers will show "Not at this bank" or "Wrong for this bank". That is the expected result. No account or login is needed.
```

## After approval

- Updates: raise `version` in `manifest.json`, run `npm run pack`, then upload the new zip.
- The Tips link points to https://paystack.shop/pay/mkp6mhtho4 (`TIPS_URL` in `src/links.js`).
