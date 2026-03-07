# ISKCON Montreal Boutique — POS Project Context

## What This Is
A donation-based Point of Sale web app for ISKCON Montreal boutique.
Pure HTML/CSS/JS with vanilla ES modules — no frameworks, no bundler. Hosted on GitHub Pages.
Catalog from Google Sheets CSV. All sales data stored in browser localStorage.
Compatible with the Mandala project stack (Jekyll 4.3, Sprae, vanilla ES modules).

## Architecture
```
index.html          — app shell with Sprae directives (:each, :if, :text, :onclick, etc.)
css/style.css       — all styles (saffron/cream/maroon theme, responsive, print)
js/config.js        — exports CONFIG object + SAMPLE_CATALOG array (12 items)
js/catalog.js       — exports Catalog object: fetch, CSV parser, localStorage cache
js/cart.js          — exports Cart object: pure data layer (add/remove/qty), no DOM
js/sales.js         — exports Sales object: record(), buildSummary(), getRecentDays()
js/state.js         — Sprae reactive state: all UI state + action handlers; self-boots on DOMContentLoaded
js/app.js           — entry point: one line `import './state.js'`
```

Entry point: `<script type="module" src="js/app.js">` → imports state.js → imports config/catalog/cart/sales.
Reactivity: `sprae(document.body, state)` in state.js binds state to the entire page.

## Key Design Decisions
- **Sprae reactivity** — `sprae(document.body, state)` in state.js; HTML uses `:each`/`:if`/`:text`/`:onclick` directives; mutating state properties triggers DOM updates automatically
- **ES modules** — all JS files use `export`/`import`; no globals; single `<script type="module">` in HTML
- **Cart is pure data** — `cart.js` has no DOM code; all rendering done by Sprae via `state.cartItems`
- **state.js owns all UI logic** — catalog filter, cart sync, sale flow, report building, admin, toast, warning dialog
- **Actual donation** field pre-fills with suggested total, but tracks `Cart._manualOverride`
  so manual edits are preserved while qty changes; resets to false after sale completes
- **Payment method** (Cash/Card) is a segmented toggle in the cart footer; resets to Cash
  after each completed sale; stored on each transaction as `paymentMethod`
- **Suggested total** uses "Suggested Donation" language everywhere, never "price"
- **F2 shortcut** focuses the actual-donation input
- **Admin panel** replaces cashier view (hidden toggle); stores sheet URL in localStorage
  under key `iskcon_config`

## localStorage Keys
| Key | Contents |
|-----|----------|
| `iskcon_catalog_cache` | `{ ts, items[] }` — last sheet fetch |
| `iskcon_sales` | Array of transaction objects |
| `iskcon_config` | `{ sheetUrl }` |

## Transaction Object Shape
```json
{
  "timestamp": "2026-03-01T14:32:00.000Z",
  "items": [{ "name": "...", "suggestedDonation": 25, "qty": 2 }],
  "suggestedTotal": 50.00,
  "actualDonation": 60.00,
  "paymentMethod": "Cash"
}
```

## Report Features
- Modal: items table, suggested vs actual summary, difference ± %, payment breakdown (Cash/Card totals + tx count)
- Print: monospace pre-formatted text, same sections, opens `window.print()`
- Past 7 days visible in Admin panel
- "Clear Today's Sales" resets only today's records

## Google Sheet Setup
Columns (exact names): `Name, Category, SuggestedDonation, ImageURL, Description`
Published via: File → Share → Publish to web → CSV → copy URL → paste in Admin or config.js

## Categories (filter buttons)
All, Books, Incense, Deities, Clothing, Food, Donations, Other

## Colours
- Saffron `#FF9933` — accent, buttons, active filter
- Cream `#FFF8F0` — page background
- Maroon `#800020` — cart header, complete sale button, active payment toggle

## Deployment
GitHub Pages: push all files, Settings → Pages → Deploy from branch → main → / (root)
