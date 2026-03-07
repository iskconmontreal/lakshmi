/**
 * ISKCON Montreal Boutique — Reactive State (Sprae)
 * Central state and all action handlers. Entry point via app.js.
 */

import sprae from 'https://cdn.jsdelivr.net/npm/sprae/+esm';
import { CONFIG, SAMPLE_CATALOG } from './config.js';
import { Catalog } from './catalog.js';
import { Cart } from './cart.js';
import { Sales } from './sales.js';

// ── Module-level non-reactive state ───────────────────────────────
let _pendingConfirm = null;
let _toastTimer     = null;

// ── Helpers ───────────────────────────────────────────────────────
function fmt(n) { return '$' + parseFloat(n || 0).toFixed(2); }

function fmtDate(key) {
  const d = new Date(key + 'T12:00:00');
  return d.toLocaleDateString('en-CA', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });
}

function esc(str) {
  const d = document.createElement('div');
  d.appendChild(document.createTextNode(String(str)));
  return d.innerHTML;
}

function calcTotal(items) {
  return items.reduce((sum, i) => sum + (i.donation ?? i.suggestedDonation) * i.qty, 0);
}

function loadStoredConfig() {
  try { return JSON.parse(localStorage.getItem(CONFIG.STORAGE_KEYS.CONFIG) || '{}'); }
  catch (_) { return {}; }
}

function applyStoredConfig() {
  try {
    const saved = loadStoredConfig();
    if (saved.sheetUrl) CONFIG.GOOGLE_SHEET_CSV_URL = saved.sheetUrl;
  } catch (_) {}
}

// ── Sprae state ───────────────────────────────────────────────────
export const state = sprae(document.body, {

  // Catalog
  catalogItems:   [],
  catalogLoading: true,
  catalogNotice:  '',
  searchQuery:    '',
  activeCategory: 'All',
  categories:     ['All', 'Books', 'Incense', 'Deities', 'Clothing', 'Food', 'Donations', 'Other'],

  // Cart
  cartItems:      [],
  suggestedTotal: 0,
  actualDonation: '',
  manualOverride: false,
  paymentMethod:  'Cash',

  // UI
  isAdminMode:  false,
  toastVisible: false,
  toastText:    '',

  // Warning dialog
  warnOpen:    false,
  warnTitle:   '',
  warnMessage: '',

  // Report modal
  reportOpen:       false,
  reportDateLabel:  '',
  reportTxCount:    '',
  reportItems:      [],
  reportHasItems:   false,
  reportSuggested:  '',
  reportActual:     '',
  reportDiff:       '',
  reportDiffLabel:  '',
  reportDiffClass:  'summary-row',
  reportPctText:    '',
  reportPayRows:    [],
  reportHasPayRows: false,

  // Admin
  sheetUrl:    '',
  connStatus:  '',
  connClass:   'conn-status',
  pastReports: [],

  // Helper exposed to templates
  fmt,

  // ── Catalog ────────────────────────────────────────────────────

  async loadCatalog(force) {
    this.catalogLoading = true;
    this.catalogItems   = [];
    this.catalogNotice  = '';
    try {
      const result = await Catalog.load(force);
      this.catalogItems = Catalog.filter(this.searchQuery, this.activeCategory);
      if (result.source === 'sample') {
        this.catalogNotice = 'No Google Sheet configured — showing sample catalog. Open Admin to connect your real inventory.';
      } else if (result.source === 'cache') {
        this.catalogNotice = 'Showing cached catalog. Click "Refresh Catalog" to fetch the latest data.';
      }
    } catch (err) {
      this.catalogNotice = 'Could not load catalog: ' + err.message;
    }
    this.catalogLoading = false;
  },

  onSearch(e) {
    this.searchQuery  = e.target.value;
    this.catalogItems = Catalog.filter(this.searchQuery, this.activeCategory);
  },

  setCategory(cat) {
    this.activeCategory = cat;
    this.catalogItems   = Catalog.filter(this.searchQuery, this.activeCategory);
  },

  // ── Cart ───────────────────────────────────────────────────────

  addToCart(product) {
    Cart.add(product);
    this._syncCart(false);
    this._flashCard(product.name);
  },

  incQty(name) {
    const item = Cart.items.find(i => i.name === name);
    if (item) Cart.setQty(name, item.qty + 1);
    this._syncCart(this.manualOverride);
  },

  decQty(name) {
    const item = Cart.items.find(i => i.name === name);
    if (item) Cart.setQty(name, item.qty - 1);
    this._syncCart(this.manualOverride);
  },

  removeFromCart(name) {
    Cart.remove(name);
    this._syncCart(false);
  },

  clearCart() {
    if (Cart.items.length === 0) return;
    if (!confirm('Clear all items from the cart?')) return;
    Cart.clear();
    this._syncCart(false);
  },

  onActualInput(e) {
    this.manualOverride = true;
    this.actualDonation = e.target.value;
  },

  setPayment(method) {
    this.paymentMethod = method;
  },

  /** Update the cashier-editable unit price for a cart line. Fires on blur/Enter. */
  updateItemDonation(name, rawValue) {
    const val = parseFloat(rawValue);
    if (isNaN(val) || val < 0) return;
    const item = Cart.items.find(i => i.name === name);
    if (!item) return;
    item.donation = val;
    this._syncCart(this.manualOverride);
  },

  _syncCart(keepOverride) {
    this.cartItems      = Cart.items.map(i => ({ ...i })); // spread so Sprae sees new objects
    this.suggestedTotal = calcTotal(this.cartItems);
    this.manualOverride = keepOverride && this.cartItems.length > 0;
    if (!this.manualOverride) {
      this.actualDonation = this.suggestedTotal > 0
        ? this.suggestedTotal.toFixed(2)
        : '';
    }
    if (this.cartItems.length === 0) this.actualDonation = '';
  },

  _flashCard(name) {
    const card = document.querySelector(`.product-card[data-name="${CSS.escape(name)}"]`);
    if (!card) return;
    card.classList.add('flash');
    setTimeout(() => card.classList.remove('flash'), 380);
  },

  // ── Sale ───────────────────────────────────────────────────────

  completeSale() {
    if (this.cartItems.length === 0) {
      alert('Cart is empty. Please add items before completing a sale.');
      return;
    }
    const suggested = this.suggestedTotal;
    const actual    = parseFloat(this.actualDonation);
    if (isNaN(actual) || actual < 0) {
      alert('Please enter a valid donation amount.');
      return;
    }
    if (actual === 0 && suggested > 0) {
      alert('Please enter the actual donation amount received.');
      return;
    }
    if (actual < suggested) {
      this._warn(
        '⚠️ Below Suggested Amount',
        `Amount received (${fmt(actual)}) is below the suggested total (${fmt(suggested)}). Continue anyway?`,
        () => this._finalizeSale(suggested, actual),
      );
    } else {
      this._finalizeSale(suggested, actual);
    }
  },

  _finalizeSale(suggested, actual) {
    Sales.record(Cart.items, suggested, actual, this.paymentMethod);
    this._showToast(actual, this.paymentMethod);
    Cart.clear();
    this._syncCart(false);
    this.paymentMethod = 'Cash';
  },

  // ── Report ─────────────────────────────────────────────────────

  openReport() {
    const txs  = Sales.getToday();
    const s    = Sales.buildSummary(txs);
    const key  = Sales._todayKey();

    this.reportDateLabel  = fmtDate(key);
    this.reportTxCount    = s.count + ' Transaction' + (s.count !== 1 ? 's' : '');
    this.reportItems      = s.items.map(i => ({ ...i, suggestedFmt: fmt(i.suggested) }));
    this.reportHasItems   = s.items.length > 0;
    this.reportSuggested  = fmt(s.suggestedTotal);
    this.reportActual     = fmt(s.actualTotal);
    this.reportDiffLabel  = s.difference >= 0 ? 'Extra Received' : 'Below Suggested';
    this.reportDiffClass  = 'summary-row ' + (s.difference > 0 ? 'diff-positive' : s.difference < 0 ? 'diff-negative' : 'diff-zero');
    this.reportDiff       = (s.difference > 0 ? '+' : '') + fmt(s.difference);
    this.reportPctText    = s.percentage !== null
      ? `Devotees gave ${Math.abs(s.percentage)}% ${s.difference >= 0 ? 'above' : 'below'} the suggested total`
      : '';
    this.reportPayRows    = Object.entries(s.byPayment)
      .filter(([, p]) => p.count > 0)
      .map(([method, p]) => ({ label: `${method} (${p.count} tx)`, total: fmt(p.total) }));
    this.reportHasPayRows = this.reportPayRows.length > 0;
    this.reportOpen       = true;
  },

  closeReport() {
    this.reportOpen = false;
  },

  printReport() {
    const txs  = Sales.getToday();
    const s    = Sales.buildSummary(txs);

    const itemLines = s.items.length > 0
      ? s.items.map(i => {
          const name = i.name.slice(0, 32).padEnd(32);
          const qty  = String(i.qty).padStart(5);
          const amt  = fmt(i.suggested).padStart(10);
          return `${name}  ${qty}   ${amt}`;
        }).join('\n')
      : '  (no items)';

    const diffSign  = s.difference > 0 ? '+' : '';
    const diffLabel = s.difference >= 0 ? 'Extra Received  ' : 'Below Suggested ';
    const pctLine   = s.percentage !== null ? `  (${diffSign}${s.percentage}%)` : '';
    const payLines  = Object.entries(s.byPayment)
      .filter(([, p]) => p.count > 0)
      .map(([method, p]) => `${'  ' + method + ' (' + p.count + ' tx):'.padEnd(22)}${fmt(p.total).padStart(12)}`)
      .join('\n');

    const report = `ISKCON MONTREAL BOUTIQUE
DAILY SALES REPORT
${this.reportDateLabel}
${'═'.repeat(55)}

Transactions: ${s.count}

ITEMS DISTRIBUTED:
${'─'.repeat(55)}
${'Item'.padEnd(32)}    Qty   Suggested
${'─'.repeat(55)}
${itemLines}
${'─'.repeat(55)}

SUMMARY:
  Suggested Total:    ${fmt(s.suggestedTotal).padStart(12)}
  Actual Donations:   ${fmt(s.actualTotal).padStart(12)}
  ${diffLabel}  ${(diffSign + fmt(s.difference)).padStart(12)}  ${pctLine}

PAYMENT BREAKDOWN:
${'─'.repeat(55)}
${payLines || '  (no transactions)'}

${'═'.repeat(55)}
              Hare Krishna
${'═'.repeat(55)}`;

    document.getElementById('print-area').innerHTML =
      `<div class="print-report"><pre>${esc(report)}</pre></div>`;
    window.print();
  },

  clearToday() {
    if (!confirm("Clear all of today's sales? This cannot be undone.")) return;
    Sales.clearToday();
    this.openReport();
  },

  // ── Toast ──────────────────────────────────────────────────────

  _showToast(amount, method) {
    this.toastText    = `${fmt(amount)} received · ${method || 'Cash'}`;
    this.toastVisible = true;
    clearTimeout(_toastTimer);
    _toastTimer = setTimeout(() => { this.toastVisible = false; }, 4000);
  },

  // ── Warning dialog ─────────────────────────────────────────────

  _warn(title, message, onOk) {
    _pendingConfirm  = onOk;
    this.warnTitle   = title;
    this.warnMessage = message;
    this.warnOpen    = true;
  },

  warnCancel()  { this.warnOpen = false; _pendingConfirm = null; },
  warnConfirm() {
    this.warnOpen = false;
    const fn = _pendingConfirm;
    _pendingConfirm = null;
    fn?.();
  },

  // ── Admin ──────────────────────────────────────────────────────

  toggleAdmin() {
    this.isAdminMode = !this.isAdminMode;
    if (this.isAdminMode) this._renderAdmin();
  },

  _renderAdmin() {
    const saved      = loadStoredConfig();
    this.sheetUrl    = saved.sheetUrl || CONFIG.GOOGLE_SHEET_CSV_URL || '';
    this.connStatus  = '';
    this.pastReports = Sales.getRecentDays(7).map(d => ({
      dateLabel: fmtDate(d.date),
      meta:      `${d.count} transactions · ${fmt(d.actualTotal)} received`,
      diff:      (d.difference > 0 ? '+' : '') + fmt(d.difference),
      diffClass: 'past-report-diff ' + (d.difference > 0 ? 'positive' : d.difference < 0 ? 'negative' : 'zero'),
    }));
  },

  async saveSheetUrl() {
    const saved    = loadStoredConfig();
    saved.sheetUrl = this.sheetUrl;
    localStorage.setItem(CONFIG.STORAGE_KEYS.CONFIG, JSON.stringify(saved));
    CONFIG.GOOGLE_SHEET_CSV_URL = this.sheetUrl;
    this.connStatus = 'URL saved. Click "Test Connection" to verify, or refresh the catalog.';
    this.connClass  = 'conn-status success';
  },

  async testConnection() {
    if (!this.sheetUrl) {
      this.connStatus = 'Please enter a URL first.';
      this.connClass  = 'conn-status error';
      return;
    }
    this.connStatus = 'Testing connection…';
    this.connClass  = 'conn-status loading';
    try {
      const resp  = await fetch(this.sheetUrl, { cache: 'no-store' });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const count = Math.max(0, (await resp.text()).trim().split(/\r?\n/).length - 1);
      this.connStatus = `✓ Connected! Found ${count} item${count !== 1 ? 's' : ''} in the sheet.`;
      this.connClass  = 'conn-status success';
    } catch (err) {
      this.connStatus = `✗ Failed: ${err.message}`;
      this.connClass  = 'conn-status error';
    }
  },

  clearAllData() {
    if (!confirm('This will erase ALL sales history and the cached catalog. Are you sure?')) return;
    if (!confirm('Last chance — delete everything?')) return;
    Sales.clearAll();
    Catalog.items = SAMPLE_CATALOG.slice();
    this._renderAdmin();
    alert('All local data cleared.');
  },

  // ── Init ───────────────────────────────────────────────────────

  async init() {
    applyStoredConfig();
    document.addEventListener('keydown', e => {
      if (e.key === 'F2' && !this.isAdminMode) {
        e.preventDefault();
        const input = document.getElementById('actual-donation');
        input.focus();
        input.select();
      }
    });
    await this.loadCatalog(false);
  },
});

// Boot
document.addEventListener('DOMContentLoaded', () => state.init());
