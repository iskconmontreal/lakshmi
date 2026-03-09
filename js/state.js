/**
 * ISKCON Montreal Boutique — Reactive State (Sprae)
 * Central state and all action handlers. Entry point via app.js.
 */

import sprae from 'https://cdn.jsdelivr.net/npm/sprae/+esm';
import { CONFIG, SAMPLE_CATALOG } from './config.js';
import { Catalog } from './catalog.js';
import { Cart } from './cart.js';
import { Sales, normalizeBillingCat } from './sales.js';
import { DB } from './db.js';

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
    if (saved.sheetUrl)    CONFIG.GOOGLE_SHEET_CSV_URL = saved.sheetUrl;
    if (saved.boutiqueKey) CONFIG.BOUTIQUE_WRITE_KEY   = saved.boutiqueKey;
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
  categories:     ['All', 'Food', 'Books', 'Incense', 'Deities', 'Clothing', 'Donations', 'Other'],

  // Cart
  cartItems:        [],
  suggestedTotal:   0,
  actualDonation:   '',
  donationReceived: 0,
  manualOverride:   false,
  paymentMethod:    'Cash',

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
  reportCatRows:    [],
  reportHasCatRows: false,
  reportTxList:     [],

  // Transaction history
  dbOpen:   false,
  dbDays:   [],
  dbStatus: '', // '' | 'loading' | 'error'

  // GitHub sync
  syncStatus: '', // '' | 'syncing' | 'ok' | 'error'
  syncMsg:    '',

  // Admin
  sheetUrl:       '',
  connStatus:     '',
  connClass:      'conn-status',
  pastReports:    [],
  boutiqueKey:    '',
  boutiqueStatus: '',
  boutiqueClass:  'conn-status',

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
    if (cat === 'All') {
      this.searchQuery = '';
      const input = document.querySelector('.search-input');
      if (input) input.value = '';
    }
    this.catalogItems = Catalog.filter(this.searchQuery, this.activeCategory);
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
    this.manualOverride   = true;
    this.actualDonation   = e.target.value;
    this.donationReceived = Math.max(0, (parseFloat(e.target.value) || 0) - this.suggestedTotal);
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
    this.donationReceived = Math.max(0, (parseFloat(this.actualDonation) || 0) - this.suggestedTotal);
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

  _categoryIcon(cat) {
    if (cat === 'Restaurant')      return '🍽️';
    if (cat === 'Books')           return '📚';
    if (cat === 'Temple Donation') return '🙏';
    return '🛍️';
  },

  _methodIcon(m) { return m === 'Card' ? '💳' : '💵'; },

  openReport() {
    try {
      const txs  = Sales.getToday();
      const s    = Sales.buildSummary(txs);
      const key  = Sales._todayKey();

      this.reportDateLabel  = fmtDate(key);
      this.reportTxCount    = s.count + ' Transaction' + (s.count !== 1 ? 's' : '');
      this.reportItems      = s.items.map(i => ({ ...i, suggestedFmt: fmt(i.suggested), icon: this._categoryIcon(i.category) }));
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
      this.reportCatRows = Object.entries(s.byCategory)
        .filter(([, v]) => v > 0)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([cat, v]) => ({ label: cat, total: fmt(v) }));
      this.reportHasCatRows = this.reportCatRows.length > 0;
      this.reportTxList = txs
        .slice()
        .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
        .map(tx => {
          const hasDonationItem = tx.items.some(i => normalizeBillingCat(i.category) === 'Temple Donation');
          const nonDonationSuggested = tx.items
            .filter(i => normalizeBillingCat(i.category) !== 'Temple Donation')
            .reduce((s, i) => s + i.suggestedDonation * i.qty, 0);
          const donationItemAmt = Math.max(0, tx.actualDonation - nonDonationSuggested);
          const extraDonation = hasDonationItem ? 0 : (tx.actualDonation - tx.suggestedTotal);
          return {
          time:       new Date(tx.timestamp).toLocaleTimeString('en-CA', { hour: '2-digit', minute: '2-digit' }),
          methodIcon: this._methodIcon(tx.paymentMethod || 'Cash'),
          method:     tx.paymentMethod || 'Cash',
          collected:  fmt(tx.actualDonation),
          items: tx.items.map(i => ({
            name:  i.name,
            qty:   i.qty,
            price: normalizeBillingCat(i.category) === 'Temple Donation'
              ? fmt(donationItemAmt)
              : fmt(i.suggestedDonation * i.qty),
            icon:  this._categoryIcon(normalizeBillingCat(i.category)),
          })),
          donation: extraDonation > 0.005
            ? '+' + fmt(extraDonation)
            : null,
          };
        });
    } catch (err) {
      console.error('[Report] Failed to build report:', err);
    }
    this.reportOpen = true;
  },

  closeReport() {
    this.reportOpen = false;
  },

  // ── Transaction History ────────────────────────────────────────

  async openDatabase() {
    this.dbOpen   = false;
    this.dbStatus = 'loading';
    this.dbDays   = [];
    this.dbOpen   = true; // open modal immediately so user sees loading state

    if (DB.isConfigured()) {
      try {
        this.dbDays   = await DB.allSales();
        this.dbStatus = '';
        return;
      } catch (err) {
        console.warn('[DB] allSales failed, falling back to localStorage:', err.message);
        this.dbStatus = 'error';
      }
    }

    // Fallback: read from localStorage
    this.dbStatus = '';
    this.dbDays   = this._buildDbDaysFromLocalStorage();
  },

  _buildDbDaysFromLocalStorage() {
    const all  = Sales._loadAll();
    const days = {};
    all.forEach(tx => {
      const day = Sales._localDateKey(tx.timestamp);
      if (!days[day]) days[day] = [];
      days[day].push(tx);
    });
    return Object.entries(days)
      .sort(([a], [b]) => b.localeCompare(a))
      .map(([date, txs]) => {
        const totalCollected = txs.reduce((s, t) => s + (t.actualDonation || 0), 0);
        const totalDonation  = txs.reduce((s, t) => s + Math.max(0, (t.actualDonation || 0) - (t.suggestedTotal || 0)), 0);
        const catMap = {};
        txs.forEach(tx => (tx.items || []).forEach(item => {
          const cat = normalizeBillingCat(item.category);
          catMap[cat] = (catMap[cat] || 0) + item.suggestedDonation * item.qty;
        }));
        const catTotals = Object.entries(catMap)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([label, v]) => ({ label, total: fmt(v) }));
        return {
          dateLabel:   fmtDate(date),
          txCount:     txs.length + ' transaction' + (txs.length !== 1 ? 's' : ''),
          dayTotal:    fmt(totalCollected),
          dayDonation: totalDonation > 0.005 ? '+' + fmt(totalDonation) : null,
          catTotals,
          transactions: txs
            .slice()
            .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
            .map(tx => {
              const hasDonItem = tx.items.some(i => normalizeBillingCat(i.category) === 'Temple Donation');
              const nonDonSuggested = tx.items
                .filter(i => normalizeBillingCat(i.category) !== 'Temple Donation')
                .reduce((s, i) => s + i.suggestedDonation * i.qty, 0);
              const donItemAmt = Math.max(0, (tx.actualDonation || 0) - nonDonSuggested);
              const extra = hasDonItem ? 0 : ((tx.actualDonation || 0) - (tx.suggestedTotal || 0));
              return {
                time:      new Date(tx.timestamp).toLocaleTimeString('en-CA', { hour: '2-digit', minute: '2-digit' }),
                method:    tx.paymentMethod || 'Cash',
                collected: fmt(tx.actualDonation),
                donation:  extra > 0.005 ? '+' + fmt(extra) : null,
                items:     tx.items.map(i => ({
                  name:     i.name,
                  qty:      i.qty,
                  price:    normalizeBillingCat(i.category) === 'Temple Donation'
                    ? fmt(donItemAmt)
                    : fmt(i.suggestedDonation * i.qty),
                  category: normalizeBillingCat(i.category),
                })),
              };
            }),
        };
      });
  },

  closeDatabase() {
    this.dbOpen     = false;
    this.syncStatus = '';
    this.syncMsg    = '';
  },

  async recordSales() {
    if (!DB.isConfigured()) {
      this.syncStatus = 'error';
      this.syncMsg    = 'Configure Boutique Write Key in Admin first.';
      return;
    }
    this.syncStatus = 'syncing';
    this.syncMsg    = '';
    try {
      const cursor = localStorage.getItem(CONFIG.STORAGE_KEYS.SYNC_CURSOR) || '';
      const newTxs = Sales._loadAll()
        .filter(tx => tx.timestamp > cursor)
        .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
      const result = await DB.appendNew(newTxs);
      if (result.count === 0) {
        this.syncStatus = 'ok';
        this.syncMsg    = '✓ Already up to date — nothing new to record.';
        return;
      }
      localStorage.setItem(CONFIG.STORAGE_KEYS.SYNC_CURSOR, result.cursor);
      this.syncStatus = 'ok';
      this.syncMsg    = `✓ ${result.count} transaction${result.count !== 1 ? 's' : ''} recorded to database.`;
    } catch (err) {
      this.syncStatus = 'error';
      this.syncMsg    = `✗ Failed: ${err.message}`;
    }
  },

  printReport() {
    const txs  = Sales.getToday();
    const s    = Sales.buildSummary(txs);

    function printCat(cat) {
      if (cat === 'Restaurant')      return '[Rest]';
      if (cat === 'Books')           return '[Book]';
      if (cat === 'Temple Donation') return '[Donat]';
      return '[Shop]';
    }

    const itemLines = s.items.length > 0
      ? s.items.map(i => {
          const name = i.name.slice(0, 28).padEnd(28);
          const qty  = String(i.qty).padStart(5);
          const amt  = fmt(i.suggested).padStart(10);
          const cat  = printCat(i.category).padStart(7);
          return `${name}  ${qty}   ${amt}  ${cat}`;
        }).join('\n')
      : '  (no items)';

    const txLines = txs.length > 0
      ? txs
          .slice()
          .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
          .map(tx => {
            const time   = new Date(tx.timestamp).toLocaleTimeString('en-CA', { hour: '2-digit', minute: '2-digit' });
            const method = (tx.paymentMethod || 'Cash').toUpperCase();
            const _nonDonSug = tx.items
              .filter(i => normalizeBillingCat(i.category) !== 'Temple Donation')
              .reduce((s, i) => s + i.suggestedDonation * i.qty, 0);
            const _donAmt = Math.max(0, tx.actualDonation - _nonDonSug);
            const _hasDon = tx.items.some(i => normalizeBillingCat(i.category) === 'Temple Donation');
            const items  = tx.items.map(i => {
              const name = ('  ' + i.name + ' \xd7' + i.qty).slice(0, 36).padEnd(36);
              const raw  = normalizeBillingCat(i.category) === 'Temple Donation'
                ? _donAmt : i.suggestedDonation * i.qty;
              const amt  = fmt(raw).padStart(8);
              const cat  = printCat(normalizeBillingCat(i.category)).padStart(7);
              return `${name}  ${amt}  ${cat}`;
            }).join('\n');
            const collected = `  ${'Collected:'.padEnd(36)}  ${fmt(tx.actualDonation).padStart(8)}`;
            return `[${method}]  ${time}\n${items}\n${collected}`;
          }).join('\n\n')
      : '  (no transactions)';

    const diffSign  = s.difference > 0 ? '+' : '';
    const diffLabel = s.difference >= 0 ? 'Extra Received  ' : 'Below Suggested ';
    const pctLine   = s.percentage !== null ? `  (${diffSign}${s.percentage}%)` : '';
    const payLines  = Object.entries(s.byPayment)
      .filter(([, p]) => p.count > 0)
      .map(([method, p]) => `${'  ' + method + ' (' + p.count + ' tx):'.padEnd(22)}${fmt(p.total).padStart(12)}`)
      .join('\n');
    const catLines  = Object.entries(s.byCategory)
      .filter(([, v]) => v > 0)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([cat, v]) => `${'  ' + cat + ':'.padEnd(24)}${fmt(v).padStart(12)}`)
      .join('\n');

    const report = `ISKCON MONTREAL BOUTIQUE
DAILY SALES REPORT
${this.reportDateLabel}
${'═'.repeat(55)}

Transactions: ${s.count}

ITEMS DISTRIBUTED:
${'─'.repeat(55)}
${'Item'.padEnd(28)}    Qty      Price    Cat.
${'─'.repeat(55)}
${itemLines}
${'─'.repeat(55)}

TRANSACTIONS:
${'─'.repeat(55)}
${txLines}

${'─'.repeat(55)}

SUMMARY:
  Item Total:         ${fmt(s.suggestedTotal).padStart(12)}
  Total Collected:    ${fmt(s.actualTotal).padStart(12)}
  ${diffLabel}  ${(diffSign + fmt(s.difference)).padStart(12)}  ${pctLine}

PAYMENT BREAKDOWN:
${'─'.repeat(55)}
${payLines || '  (no transactions)'}

REVENUE BY CATEGORY:
${'─'.repeat(55)}
${catLines || '  (no transactions)'}

${'═'.repeat(55)}
              Hare Krishna
${'═'.repeat(55)}`;

    document.getElementById('print-area').innerHTML =
      `<div class="print-report"><pre>${esc(report)}</pre></div>`;
    window.print();
  },

  printDatabase() {
    function printCat(cat) {
      if (cat === 'Restaurant')      return '[Rest]';
      if (cat === 'Books')           return '[Book]';
      if (cat === 'Temple Donation') return '[Donat]';
      return '[Shop]';
    }

    const dayBlocks = this.dbDays.map(day => {
      const txLines = day.transactions.map(tx => {
        const method = tx.method.toUpperCase();
        const items  = tx.items.map(i => {
          const name = ('  ' + i.name + ' \xd7' + i.qty).slice(0, 36).padEnd(36);
          const amt  = i.price.padStart(8);
          const cat  = printCat(i.category).padStart(7);
          return `${name}  ${amt}  ${cat}`;
        }).join('\n');
        const collected = `  ${'Collected:'.padEnd(36)}  ${tx.collected.padStart(8)}`;
        const donation  = tx.donation ? `\n  ${'Donation:'.padEnd(36)}  ${tx.donation.padStart(8)}` : '';
        return `[${method}]  ${tx.time}\n${items}\n${collected}${donation}`;
      }).join('\n\n');

      const catLine = (day.catTotals || []).map(ct => `${ct.label}: ${ct.total}`).join('  /  ');
      return `${day.dateLabel}  —  ${day.dayTotal}${day.dayDonation ? '  ' + day.dayDonation : ''}  (${day.txCount})
${catLine ? '  ' + catLine + '\n' : ''}${'─'.repeat(55)}
${txLines || '  (no transactions)'}`;
    }).join('\n\n' + '═'.repeat(55) + '\n\n');

    const report = `ISKCON MONTREAL BOUTIQUE
DATABASE RECORDS
${'═'.repeat(55)}

${dayBlocks || '(no records)'}

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
    const saved         = loadStoredConfig();
    this.sheetUrl       = saved.sheetUrl    || CONFIG.GOOGLE_SHEET_CSV_URL || '';
    this.connStatus     = '';
    this.boutiqueKey    = saved.boutiqueKey || CONFIG.BOUTIQUE_WRITE_KEY   || '';
    this.boutiqueStatus = '';
    this.boutiqueClass  = 'conn-status';
    this.pastReports    = Sales.getRecentDays(7).map(d => ({
      dateLabel: fmtDate(d.date),
      meta:      `${d.count} transactions · ${fmt(d.actualTotal)} received`,
      diff:      (d.difference > 0 ? '+' : '') + fmt(d.difference),
      diffClass: 'past-report-diff ' + (d.difference > 0 ? 'positive' : d.difference < 0 ? 'negative' : 'zero'),
    }));
  },

  saveBoutiqueKey() {
    const saved           = loadStoredConfig();
    saved.boutiqueKey     = this.boutiqueKey.trim();
    localStorage.setItem(CONFIG.STORAGE_KEYS.CONFIG, JSON.stringify(saved));
    CONFIG.BOUTIQUE_WRITE_KEY = saved.boutiqueKey;
    this.boutiqueStatus   = 'Saved. Click "Test Connection" to verify.';
    this.boutiqueClass    = 'conn-status success';
  },

  async testBoutiqueConnection() {
    this.boutiqueStatus = 'Testing…';
    this.boutiqueClass  = 'conn-status loading';
    CONFIG.BOUTIQUE_WRITE_KEY = this.boutiqueKey.trim();
    const { ok, message } = await DB.testConnection();
    this.boutiqueStatus = message;
    this.boutiqueClass  = 'conn-status ' + (ok ? 'success' : 'error');
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
    localStorage.removeItem(CONFIG.STORAGE_KEYS.SYNC_CURSOR);
    Catalog.items = SAMPLE_CATALOG.slice();
    this._renderAdmin();
    alert('All local data cleared.');
  },

  async clearBackendData() {
    if (!DB.isConfigured()) { alert('Backend not configured.'); return; }
    if (!confirm('This will permanently delete ALL sales from the backend database. Are you sure?')) return;
    if (!confirm('Last chance — wipe the entire backend database?')) return;
    try {
      await DB.clearAll();
      localStorage.removeItem(CONFIG.STORAGE_KEYS.SYNC_CURSOR);
      alert('Backend database cleared.');
    } catch (err) {
      alert('Error: ' + err.message);
    }
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
