# ISKCON Montreal Boutique — Point of Sale

A donation-based POS web application for ISKCON Montreal.
Runs entirely in the browser, hosted on GitHub Pages, with the product catalog
managed in Google Sheets and all transaction data stored locally in the browser.

---

## What Was Created

| File | Purpose |
|------|---------|
| `index.html` | Single-page app shell with all HTML sections |
| `css/style.css` | Full responsive stylesheet — saffron/cream/maroon theme, print styles |
| `js/config.js` | Google Sheet URL + full 12-item sample catalog |
| `js/catalog.js` | CSV fetch, parser (handles quotes/BOM), localStorage cache |
| `js/cart.js` | Cart state, qty controls, actual-donation sync logic |
| `js/sales.js` | Transaction recording, daily summaries, 7-day history |
| `js/app.js` | App bootstrap, all event delegation, UI controllers |
| `README.md` | Full setup guide, GitHub Pages deployment, daily workflow |

## Key Behaviours

- **Works immediately** — opens in any browser with the sample 12-item catalog, no server needed
- **Actual donation tracking** — the `$` input pre-fills with the suggested total but cashiers can type any amount; it only auto-updates when you haven't manually changed it
- **Below-suggested warning** — if actual < suggested, a confirmation dialog appears before saving
- **Google Sheet sync** — paste a published CSV URL in Admin or directly in `config.js`; "Refresh Catalog" force-fetches and re-caches
- **Offline fallback** — serves the cached catalog if the Sheet is unreachable
- **Daily report + print** — monospace Courier print format that matches the spec exactly
- **Event delegation** — all cart and catalog clicks handled safely without inline JS
- **F2 shortcut** — jumps focus to the actual-donation input for fast keyboard entry

---

## Quick Start

Open `index.html` in any modern browser. The app loads with a built-in sample
catalog so you can try it immediately — no setup required.

---

## File Structure

```
iskcon-pos/
├── index.html          Main application
├── css/
│   └── style.css       All styles
├── js/
│   ├── config.js       Google Sheet URL + sample catalog data
│   ├── catalog.js      Fetch, parse, and cache the product catalog
│   ├── cart.js         Cart state and rendering
│   ├── sales.js        Transaction recording and report generation
│   └── app.js          App bootstrap, event wiring, UI controllers
└── README.md           This file
```

---

## Setting Up Your Google Sheet Catalog

### 1 · Create the spreadsheet

1. Go to [Google Sheets](https://sheets.google.com) and create a new spreadsheet.
2. **Row 1 must be the header row** with exactly these column names
   (spelling and capitalisation matter):

   | A    | B        | C                 | D        | E           |
   |------|----------|-------------------|----------|-------------|
   | Name | Category | SuggestedDonation | ImageURL | Description |

3. Fill in your items starting from row 2. Example:

   | Name                    | Category | SuggestedDonation | ImageURL                           | Description       |
   |-------------------------|----------|-------------------|------------------------------------|-------------------|
   | Bhagavad Gita As It Is  | Books    | 25.00             | https://i.imgur.com/yourimage.jpg  | Hardcover edition |
   | Incense Box (Nag Champa)| Incense  | 5.00              |                                    | 12 sticks         |
   | General Donation        | Donations| 0.00              |                                    | Any amount        |

   **Category values** recognised by the filter buttons:
   `Books`, `Incense`, `Deities`, `Clothing`, `Food`, `Donations`, `Other`
   (Any other value still works — items appear under "All" but won't match a
   specific filter button.)

### 2 · Publish the sheet as CSV

1. **File → Share → Publish to web**
2. In the first dropdown, choose the **sheet tab** that contains your items
   (usually "Sheet1").
3. In the second dropdown, choose **Comma-separated values (.csv)**.
4. Click **Publish** and confirm.
5. Copy the URL that appears — it will look like:
   ```
   https://docs.google.com/spreadsheets/d/e/2PACX-…/pub?gid=0&single=true&output=csv
   ```

### 3 · Add the URL to the app

**Option A — Admin panel (recommended):**
1. Open the app → click **Admin** (top right).
2. Paste the URL into the "Google Sheet Configuration" field.
3. Click **Save URL**, then **Test Connection** to verify.
4. Click **← Back to POS**, then **↻ Refresh Catalog**.

**Option B — Edit `config.js` directly:**
Open `js/config.js` and replace the empty string:
```javascript
GOOGLE_SHEET_CSV_URL: 'https://docs.google.com/spreadsheets/…',
```

---

## Adding Product Images

Product images are referenced by URL in the `ImageURL` column.
If a URL is blank or the image fails to load, the app shows a 🙏 emoji placeholder.

**Recommended free image hosts:**

| Host | Notes |
|------|-------|
| [Imgur](https://imgur.com) | Upload → right-click image → "Copy image address" |
| Google Drive | Share file publicly → use direct-link converter |
| Any public CDN | Direct `.jpg` / `.png` / `.webp` URL works |

**Tip:** Images display at a 3:4 aspect ratio (portrait). Cropping photos to
roughly 300 × 400 px looks best.

---

## Deploying to GitHub Pages

1. Create a new GitHub repository (e.g. `iskcon-pos`).
2. Upload all files maintaining the folder structure:
   ```
   index.html
   css/style.css
   js/config.js
   js/catalog.js
   js/cart.js
   js/sales.js
   js/app.js
   ```
3. In the repository → **Settings → Pages**.
4. Under **Source**, select **Deploy from a branch** → choose `main` → `/ (root)`.
5. Click **Save**. After a minute your site is live at:
   ```
   https://<your-username>.github.io/<repo-name>/
   ```

> **Note:** GitHub Pages serves over HTTPS, which is required for the
> `fetch()` call to retrieve the Google Sheet CSV.

---

## Daily Cashier Workflow

### Starting the day
- Open the app on a tablet or desktop browser.
- If the catalog was updated since yesterday, click **↻ Refresh Catalog**.

### Processing a donation
1. **Tap a product card** to add it to the cart. Tap again to add another unit.
2. Use the **−** / **+** buttons in the cart to adjust quantities.
3. The **SUGGESTED TOTAL** updates automatically.
4. The **ACTUAL DONATION RECEIVED** field is pre-filled with the suggested
   total. If the devotee gives a different amount, type it in.
5. Click **COMPLETE SALE**.
   - If the amount is below the suggested total, a warning confirms you want
     to proceed (useful when someone donates what they can).
6. A "Thank you! Hare Krishna" confirmation appears briefly.

### End of day
1. Click **📊 Daily Report**.
2. Review the summary: transactions, items distributed, suggested vs actual,
   and the **Payment Breakdown** (Cash total / Card total) for cash-drawer reconciliation.
3. Click **🖨 Print Report** to open the browser print dialog with a
   clean monospace layout (payment breakdown is included).
4. Click **Clear Today's Sales** (with confirmation) to reset for the next day.

---

## Keyboard Shortcut

| Key | Action |
|-----|--------|
| **F2** | Focus the "Actual Donation Received" input |

---

## Data Storage

All data lives in the browser's `localStorage` — nothing is sent to a server.

| Key | Contents |
|-----|----------|
| `iskcon_catalog_cache` | Last-fetched catalog (JSON) |
| `iskcon_sales` | All transaction records (JSON array) |
| `iskcon_config` | Saved settings, e.g. sheet URL |

To move data to a new device, or to back it up, you can copy the localStorage
entries using the browser's developer tools (Application → Local Storage).

---

## Updating the Catalog

1. Edit your Google Sheet and save.
2. In the app, click **↻ Refresh Catalog** — the app re-fetches the CSV,
   parses it, and caches it locally.

No code changes or redeployment needed.

---

## Offline Use

If the internet is unavailable, the app automatically falls back to the
**locally cached catalog** (from the last successful fetch). Existing sales
data is always available offline. New transactions save normally to
localStorage. Click **Refresh Catalog** when connectivity is restored.

---

## Transaction Record Format

Each completed sale is stored as a JSON object:

```json
{
  "timestamp": "2026-03-01T14:32:00.000Z",
  "items": [
    { "name": "Bhagavad Gita As It Is", "suggestedDonation": 25, "qty": 2 }
  ],
  "suggestedTotal": 50.00,
  "actualDonation": 60.00,
  "paymentMethod": "Cash"
}
```

`paymentMethod` is either `"Cash"` or `"Card"`. The daily report and print-out
both include a **Payment Breakdown** section showing the total received and
number of transactions per method — useful for reconciling the cash drawer
against the card terminal at end of day.

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| "No items found" after refresh | Check that the Google Sheet URL is correct and published as CSV |
| Images not showing | Verify the image URL is a direct link (ends in `.jpg`, `.png`, etc.) and is publicly accessible |
| Old catalog data loading | Click **↻ Refresh Catalog** to force a re-fetch |
| App not loading on GitHub Pages | Ensure all file paths are lowercase and match exactly |
| CORS error in browser console | The Google Sheet must be published via **Publish to web**, not just shared — re-publish and copy the new URL |

---

## Hare Krishna 🙏
