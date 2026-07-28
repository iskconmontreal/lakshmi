/**
 * ISKCON Montreal Boutique — Reactive State (Sprae)
 * Central state and all action handlers. Entry point via app.js.
 */

import sprae from 'https://cdn.jsdelivr.net/npm/sprae/+esm';
import { CONFIG, SAMPLE_CATALOG } from './config.js';
import { Catalog } from './catalog.js';
import { Cart } from './cart.js';
import { Sales, normalizeBillingCat } from './sales.js';
import { DB, txToApiShape } from './db.js';
import { auth } from './auth.js';
import { Sync } from './sync.js';

// ── Module-level non-reactive state ───────────────────────────────
let _pendingConfirm = null;
let _toastTimer     = null;
let _retrying       = false; // retryPending() reentrancy guard — reachable from banner, report, login, and auto-sync

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

function calcCatalogTotal(items) {
  return items.reduce((sum, i) => sum + i.suggestedDonation * i.qty, 0);
}
function calcCartTotal(items) {
  return items.reduce((sum, i) => sum + (i.donation ?? i.suggestedDonation) * i.qty, 0);
}
function calcExplicitDonation(items) {
  return items.reduce((sum, i) => {
    if (normalizeBillingCat(i.category) !== 'Temple Donation') return sum;
    return sum + (i.donation ?? i.suggestedDonation) * i.qty;
  }, 0);
}
function calcCatalogNonDonationTotal(items) {
  return items.reduce((sum, i) => {
    if (normalizeBillingCat(i.category) === 'Temple Donation') return sum;
    return sum + i.suggestedDonation * i.qty;
  }, 0);
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
  searchQuery:        '',
  activeCategory:     'All',
  categories:         ['All', 'Food', 'Books', 'Incense', 'Deities', 'Clothing', 'Donations', 'Other'],
  activeLanguage:     'All',
  availableLanguages: [],
  showLanguageFilter: false,

  // Cart
  cartItems:        [],
  suggestedTotal:   0,
  cartTotal:        0,
  actualDonation:   '',
  explicitDonation: 0,
  overpayment:      0,
  manualOverride:   false,
  paymentMethod:    'Cash',

  // UI
  isAdminMode:  false,
  toastVisible: false,
  toastTitle:   '',   // 'Thank you! Hare Krishna' for sale receipts; empty for sync/status notices
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
  reportSuggested:   '',
  reportActual:      '',
  reportDonation:    '',
  reportOverpayment: '',
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

  // Auth (per-user Goloka login)
  needLogin:   true,
  authStep:    'email', // 'email' | 'password' | 'otp'
  authEmail:   '',
  authPassword:'',
  authOtp:     '',
  authError:   '',
  authLoading: false,
  userName:    '',

  // Offline sync
  isOffline:     false,
  pendingCount:  0,
  pendingError:  '',
  archiveCount:  0,
  archiveWarning:'',
  repushing:     false,
  repushStatus:  '',

  // Helper exposed to templates
  fmt,

  // ── Catalog ────────────────────────────────────────────────────

  async loadCatalog(force) {
    this.catalogLoading = true;
    this.catalogItems   = [];
    this.catalogNotice  = '';
    try {
      const result = await Catalog.load(force);
      this.availableLanguages = [...new Set(
        Catalog.items
          .filter(i => i.category === 'Sankirtan Books' && i.language)
          .map(i => i.language)
      )].sort();
      this.catalogItems = Catalog.filter(this.searchQuery, this.activeCategory, this.activeLanguage);
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
    this.catalogItems = Catalog.filter(this.searchQuery, this.activeCategory, this.activeLanguage);
  },

  setCategory(cat) {
    this.activeCategory = cat;
    if (cat === 'All') {
      this.searchQuery = '';
      const input = document.querySelector('.search-input');
      if (input) input.value = '';
    }
    const onBooks = cat === 'Books';
    this.showLanguageFilter = onBooks && this.availableLanguages.length > 0;
    if (!onBooks) this.activeLanguage = 'All';
    this.catalogItems = Catalog.filter(this.searchQuery, this.activeCategory, this.activeLanguage);
  },

  setLanguage(lang) {
    this.activeLanguage = lang;
    this.catalogItems   = Catalog.filter(this.searchQuery, this.activeCategory, this.activeLanguage);
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
    const catalogND     = calcCatalogNonDonationTotal(this.cartItems);
    this.overpayment    = Math.max(0, (parseFloat(e.target.value) || 0) - this.explicitDonation - catalogND);
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
    this.suggestedTotal = calcCatalogTotal(this.cartItems);
    this.cartTotal      = calcCartTotal(this.cartItems);
    this.manualOverride = keepOverride && this.cartItems.length > 0;
    if (!this.manualOverride) {
      this.actualDonation = this.cartTotal > 0
        ? this.cartTotal.toFixed(2)
        : '';
    }
    if (this.cartItems.length === 0) this.actualDonation = '';
    this.explicitDonation = calcExplicitDonation(this.cartItems);
    const catalogND       = calcCatalogNonDonationTotal(this.cartItems);
    this.overpayment      = Math.max(0, (parseFloat(this.actualDonation) || 0) - this.explicitDonation - catalogND);
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
    // Record locally first (the reporting store + the receipt toast never depend
    // on connectivity), then fire the Goloka submit without awaiting so the till
    // is instantly ready for the next customer.
    const tx = Sales.record(Cart.items, suggested, actual, this.paymentMethod);
    this._showToast(actual, this.paymentMethod);
    Cart.clear();
    this._syncCart(false);
    this.paymentMethod = 'Cash';
    this._submitSale(txToApiShape(tx), Sync.newKey());
  },

  // Push one sale to Goloka. On any failure the sale is queued (already safe in
  // the local reporting store) and auto-retried on reconnect. Adapted from
  // sankirtan-pos submitSession.
  async _submitSale(payload, key) {
    try {
      const result = await DB.postSale(payload, key);
      this._reportArchive(Sync.saveRecent(result, payload, key));
      this.archiveCount = Sync.getRecent().length;
    } catch (err) {
      console.warn('[DB] postSale failed:', err.message);
      Sync.savePending(payload, key, auth.userId);
      this.pendingCount = Sync.getPending().length;
      this.isOffline    = true;
      if (err.authExpired) {
        this.pendingError = '';
        this._banner('✗ Signed out — the sale is kept SAFE on this device. Sign in to submit.');
        this._showLogin();
      } else if (err.status) {
        this.pendingError = `${err.message} (HTTP ${err.status})`;
        this._banner(`✗ Goloka rejected the sale: ${err.message} — kept SAFE on this device.`);
      } else {
        this.pendingError = '';
        this._banner('✗ Goloka unreachable — sale kept SAFE on this device. Will resubmit automatically.');
      }
    }
  },

  _reportArchive(status) {
    if (status === 'pruned') {
      this.archiveWarning = '⚠ Device archive is full — oldest submitted sales were removed to make space. Consider re-sending to Goloka soon.';
    } else if (status === 'error') {
      this.archiveWarning = '⚠ Could not keep a copy of the submitted sale on this device (storage full).';
    }
  },

  // A lightweight status line reused by the sync flows (distinct from the sale
  // receipt toast, which takes an amount).
  _banner(msg) {
    this.toastTitle   = '';   // plain notice — no "Thank you" receipt header
    this.toastText    = msg;
    this.toastVisible = true;
    clearTimeout(_toastTimer);
    _toastTimer = setTimeout(() => { this.toastVisible = false; }, 4500);
  },

  // ── Report ─────────────────────────────────────────────────────

  _categoryIcon(cat) {
    if (cat === 'Restaurant')      return '🍽️';
    if (cat === 'Books')           return '📚';
    if (cat === 'Sankirtan Books') return '📚';
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
      this.reportSuggested   = fmt(s.suggestedTotal);
      this.reportActual      = fmt(s.actualTotal);
      this.reportDonation    = fmt(s.donationTotal);
      this.reportOverpayment = fmt(s.overpaymentTotal);
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
          const txDonation = tx.items
            .filter(i => normalizeBillingCat(i.category) === 'Temple Donation')
            .reduce((s, i) => s + (i.donation ?? i.suggestedDonation) * i.qty, 0);
          const txCatalogND = tx.items
            .filter(i => normalizeBillingCat(i.category) !== 'Temple Donation')
            .reduce((s, i) => s + i.suggestedDonation * i.qty, 0);
          const txOverpayment = Math.max(0, tx.actualDonation - txDonation - txCatalogND);
          const txExtra = txDonation + txOverpayment;
          return {
          time:       new Date(tx.timestamp).toLocaleTimeString('en-CA', { hour: '2-digit', minute: '2-digit' }),
          methodIcon: this._methodIcon(tx.paymentMethod || 'Cash'),
          method:     tx.paymentMethod || 'Cash',
          collected:  fmt(tx.actualDonation),
          items: tx.items.map(i => ({
            name:  i.name,
            qty:   i.qty,
            price: normalizeBillingCat(i.category) === 'Temple Donation'
              ? fmt((i.donation ?? i.suggestedDonation) * i.qty)
              : fmt(i.suggestedDonation * i.qty),
            icon:  this._categoryIcon(normalizeBillingCat(i.category)),
          })),
          donation: txExtra > 0.005 ? '+' + fmt(txExtra) : null,
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
    if (!auth.active) {
      // Not signed in — show the local reporting store only.
      this.dbStatus = '';
      this.dbDays   = this._buildDbDaysFromLocalStorage();
      this.dbOpen   = true;
      return;
    }

    // Async path: open immediately with loading state, then populate
    this.dbDays   = [];
    this.dbStatus = 'loading';
    this.dbOpen   = true;
    try {
      this.dbDays   = await DB.allSales();
      this.dbStatus = '';
    } catch (err) {
      console.warn('[DB] allSales failed, falling back to localStorage:', err.message);
      this.dbStatus = '';
      this.dbDays   = this._buildDbDaysFromLocalStorage();
    }
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
          const amt = cat === 'Temple Donation'
            ? (item.donation ?? item.suggestedDonation) * item.qty
            : item.suggestedDonation * item.qty;
          catMap[cat] = (catMap[cat] || 0) + amt;
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
              const txExtra = Math.max(0, (tx.actualDonation || 0) - (tx.suggestedTotal || 0));
              return {
                time:      new Date(tx.timestamp).toLocaleTimeString('en-CA', { hour: '2-digit', minute: '2-digit' }),
                method:    tx.paymentMethod || 'Cash',
                collected: fmt(tx.actualDonation),
                donation:  txExtra > 0.005 ? '+' + fmt(txExtra) : null,
                items:     tx.items.map(i => ({
                  name:     i.name,
                  qty:      i.qty,
                  price:    normalizeBillingCat(i.category) === 'Temple Donation'
                    ? fmt((i.donation ?? i.suggestedDonation) * i.qty)
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

  // Manual fallback for the Daily Report "Record Sales" button. Sales now sync
  // automatically per-sale; this just flushes anything still queued (e.g. saved
  // while offline) and reports the queue state.
  async recordSales() {
    if (!auth.active) {
      this.syncStatus = 'error';
      this.syncMsg    = 'Please sign in to record sales.';
      return;
    }
    this.syncStatus = 'syncing';
    this.syncMsg    = '';
    if (Sync.getPending().length === 0) {
      this.syncStatus = 'ok';
      this.syncMsg    = '✓ Already up to date — every sale is in the database.';
      return;
    }
    await this.retryPending();
    this.syncStatus = this.pendingCount === 0 ? 'ok' : 'error';
    this.syncMsg    = this.pendingCount === 0
      ? '✓ All sales recorded to the database.'
      : `✗ ${this.pendingCount} sale(s) still pending — ${this.pendingError || 'will retry automatically.'}`;
  },

  // ── Auth ───────────────────────────────────────────────────────
  // Email first; the server answers with `password_required` or `otp_required`
  // (or a token directly for trusted devices). Google is a one-tap alternative.

  _showLogin() {
    this.needLogin    = true;
    this.isAdminMode  = false;
    this.authStep     = 'email';
    this.authPassword = '';
    this.authOtp      = '';
  },

  async authSubmitEmail() {
    if (this.authLoading || !this.authEmail.trim()) return;
    this.authError   = '';
    this.authLoading = true;
    try {
      const res = await DB.login(this.authEmail.trim(), '');
      if (res.step === 'password_required')  this.authStep = 'password';
      else if (res.step === 'otp_required')  this.authStep = 'otp';
      else if (res.token) {
        auth.save(res.token, res.user, res.refresh_token);
        await this._postLogin();
      }
    } catch (err) {
      this.authError = err.message || 'Sign in failed';
    }
    this.authLoading = false;
  },

  async authSubmitPassword() {
    if (this.authLoading) return;
    this.authError   = '';
    this.authLoading = true;
    try {
      const res = await DB.login(this.authEmail.trim(), this.authPassword);
      if (res.step === 'otp_required') this.authStep = 'otp';
      else if (res.token) {
        auth.save(res.token, res.user, res.refresh_token);
        await this._postLogin();
      }
    } catch (err) {
      this.authError = err.message || 'Sign in failed';
    }
    this.authLoading = false;
  },

  async authVerifyOtp() {
    if (this.authLoading) return;
    this.authError   = '';
    this.authLoading = true;
    try {
      const res = await DB.verifyOtp(this.authEmail.trim(), this.authOtp.trim());
      auth.save(res.token, res.user, res.refresh_token);
      await this._postLogin();
    } catch (err) {
      this.authError = err.message || 'Verification failed';
    }
    this.authLoading = false;
  },

  async authGoogle() {
    this.authError = '';
    try {
      const { url } = await DB.googleUrl();
      window.location.href = url;
    } catch (err) {
      this.authError = 'Could not connect to server';
    }
  },

  async logout() {
    await DB.logout();     // best-effort refresh-token revocation
    auth.clear();          // auth keys only — the queue/archive survive
    this.userName = '';
    this._showLogin();
  },

  // Everything that needs a logged-in cashier: permission gate, legacy-sales
  // migration, catalog load, and the pending-queue flush.
  async _postLogin() {
    if (!auth.can('boutique:create')) {
      auth.clear();
      this._showLogin();
      this.authError = 'This account has no boutique access — ask the temple admin for the Boutique Cashier role.';
      return;
    }
    this.needLogin = false;
    this.authError = '';
    this.userName  = auth.displayName();

    // One-time: convert any locally-recorded-but-unsynced sales into the queue.
    const migrated = Sync.migrateLegacy();
    if (migrated > 0) {
      this._banner(`Found ${migrated} sale(s) from before sign-in — sending to Goloka…`);
    }

    await this.loadCatalog(false);

    this.pendingCount = Sync.getPending().length;
    this.archiveCount = Sync.getRecent().length;
    if (this.pendingCount > 0) {
      this.isOffline = true;
      this.retryPending();
    }
  },

  // ── Pending retry ──────────────────────────────────────────────

  async retryPending() {
    // Single flight: overlapping runs would re-POST the same items (harmless to
    // Goloka thanks to the idempotency keys) but archive them twice locally.
    if (_retrying) return;
    _retrying = true;
    try {
      const pending = Sync.getPending();
      if (pending.length === 0) { this.pendingCount = 0; this.pendingError = ''; return; }

      let succeeded = 0, foreign = 0, lastErr = null;
      for (const item of pending) {
        // Goloka attributes every submission to the JWT holder, so a sale queued by
        // a different cashier waits for its owner to sign in. Legacy items (no
        // user_id) flush under the current user.
        if (item.user_id && auth.userId && item.user_id !== auth.userId) { foreign++; continue; }
        const key = item.idempotency_key || Sync.newKey();
        try {
          const result = await DB.postSale(item.payload, key);
          this._reportArchive(Sync.saveRecent(result, item.payload, key));
          Sync.removePending(item.id);
          succeeded++;
        } catch (err) {
          console.warn('[Retry] Failed for id', item.id, err.message);
          lastErr = err;
          if (err.authExpired) break;
        }
      }

      this.pendingCount = Sync.getPending().length;
      this.archiveCount = Sync.getRecent().length;
      if (this.pendingCount === 0) { this.isOffline = false; this.pendingError = ''; }
      else if (lastErr) {
        this.pendingError = lastErr.status ? `${lastErr.message} (HTTP ${lastErr.status})` : lastErr.message;
      }

      if (lastErr && lastErr.authExpired) {
        this._banner('✗ Signed out — queued sale(s) kept on this device. Sign in to submit.');
        this._showLogin();
        return;
      }
      if (succeeded > 0 && this.pendingCount === 0) {
        this._banner(`✓ ${succeeded} queued sale(s) now recorded in Goloka.`);
      } else if (foreign > 0 && foreign === pending.length) {
        this._banner(`${foreign} pending sale(s) belong to another account — that cashier must sign in to submit them.`);
      }
    } finally {
      _retrying = false;
    }
  },

  // Wipe the pending queue — for a sale Goloka permanently rejects.
  discardPending() {
    Sync.getPending().forEach(p => Sync.removePending(p.id));
    this.pendingCount = 0;
    this.pendingError = '';
    this.isOffline    = false;
    this._banner('Pending sale(s) discarded.');
  },

  // ── Re-push (disaster recovery) ────────────────────────────────
  // Re-send every sale this device knows about (queued + archived) with its
  // original idempotency key. Goloka replays what it already has and recreates
  // what it lost. Safe to run anytime.
  async repushAll() {
    if (this.repushing) return;
    this.repushing    = true;
    this.repushStatus = 'Re-sending all sales to Goloka…';

    let already = 0, recovered = 0, failed = 0, skipped = 0;

    for (const item of Sync.getPending()) {
      if (item.user_id && auth.userId && item.user_id !== auth.userId) { skipped++; continue; }
      const key = item.idempotency_key || Sync.newKey();
      try {
        const { replayed } = await DB.repostSale(item.payload, key);
        this._reportArchive(Sync.saveRecent({}, item.payload, key));
        Sync.removePending(item.id);
        replayed ? already++ : recovered++;
      } catch (err) {
        console.warn('[Repush] pending failed:', err.message);
        failed++;
      }
    }

    for (const entry of Sync.getRecent().slice().reverse()) {
      if (!entry.payload || !entry.idempotency_key) { skipped++; continue; }
      try {
        const { replayed } = await DB.repostSale(entry.payload, entry.idempotency_key);
        replayed ? already++ : recovered++;
      } catch (err) {
        console.warn('[Repush] archived failed:', err.message);
        failed++;
      }
    }

    this.pendingCount = Sync.getPending().length;
    if (this.pendingCount === 0 && failed === 0) { this.isOffline = false; this.pendingError = ''; }
    this.archiveCount = Sync.getRecent().length;

    const total = already + recovered + failed;
    let msg;
    if (total === 0 && skipped === 0) {
      msg = 'Nothing to re-send — no sales stored on this device yet.';
    } else if (failed === 0 && recovered === 0) {
      msg = `✓ All ${already} sale(s) already in Goloka — nothing was lost.`;
    } else {
      msg = `✓ ${already} already registered · ${recovered} recovered · ${failed} failed.`;
    }
    if (skipped > 0) msg += ` (${skipped} sale(s) skipped: no stored copy, or queued by another account.)`;
    this.repushStatus = msg;
    this._banner(msg);
    this.repushing = false;
  },

  printReport() {
    const txs  = Sales.getToday();
    const s    = Sales.buildSummary(txs);

    function printCat(cat) {
      if (cat === 'Restaurant')      return '[Rest]';
      if (cat === 'Books')           return '[Book]';
      if (cat === 'Sankirtan Books') return '[Book]';
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
            const items  = tx.items.map(i => {
              const name = ('  ' + i.name + ' \xd7' + i.qty).slice(0, 36).padEnd(36);
              const raw  = normalizeBillingCat(i.category) === 'Temple Donation'
                ? (i.donation ?? i.suggestedDonation) * i.qty
                : i.suggestedDonation * i.qty;
              const amt  = fmt(raw).padStart(8);
              const cat  = printCat(normalizeBillingCat(i.category)).padStart(7);
              return `${name}  ${amt}  ${cat}`;
            }).join('\n');
            const collected = `  ${'Collected:'.padEnd(36)}  ${fmt(tx.actualDonation).padStart(8)}`;
            return `[${method}]  ${time}\n${items}\n${collected}`;
          }).join('\n\n')
      : '  (no transactions)';

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
  Donation:           ${fmt(s.donationTotal).padStart(12)}
  Over-Payment:       ${fmt(s.overpaymentTotal).padStart(12)}
  Total Collected:    ${fmt(s.actualTotal).padStart(12)}

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
      if (cat === 'Sankirtan Books') return '[Book]';
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
        const collected   = `  ${'Collected:'.padEnd(36)}  ${tx.collected.padStart(8)}`;
        const donation    = tx.donation    ? `\n  ${'Donation:'.padEnd(36)}  ${tx.donation.padStart(8)}` : '';
        const overpayment = tx.overpayment ? `\n  ${'Over-Payment:'.padEnd(36)}  ${tx.overpayment.padStart(8)}` : '';
        return `[${method}]  ${tx.time}\n${items}\n${collected}${donation}${overpayment}`;
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
    this.toastTitle   = 'Thank you! Hare Krishna';
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
    this.sheetUrl       = saved.sheetUrl || CONFIG.GOOGLE_SHEET_CSV_URL || '';
    this.connStatus     = '';
    this.pendingCount   = Sync.getPending().length;
    this.archiveCount   = Sync.getRecent().length;
    this.pastReports    = Sales.getRecentDays(7).map(d => ({
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
    if (!confirm('This will erase ALL sales history, the sync queue, and the cached catalog. Are you sure?')) return;
    if (!confirm('Last chance — delete everything?')) return;
    Sales.clearAll();
    localStorage.removeItem(CONFIG.STORAGE_KEYS.PENDING);
    localStorage.removeItem(CONFIG.STORAGE_KEYS.RECENT);
    this.pendingCount = 0;
    this.archiveCount = 0;
    Catalog.items = SAMPLE_CATALOG.slice();
    this._renderAdmin();
    alert('All local data cleared.');
  },

  async clearBackendData() {
    if (!auth.active) { alert('Please sign in first.'); return; }
    if (!confirm('This will permanently delete ALL sales from the backend database. Are you sure?')) return;
    if (!confirm('Last chance — wipe the entire backend database?')) return;
    try {
      await DB.clearAll();
      alert('Backend database cleared.');
    } catch (err) {
      alert('Error: ' + err.message);
    }
  },

  // ── Init ───────────────────────────────────────────────────────

  async init() {
    applyStoredConfig();
    document.addEventListener('keydown', e => {
      if (e.key === 'F2' && !this.isAdminMode && !this.needLogin) {
        e.preventDefault();
        const input = document.getElementById('actual-donation');
        if (input) { input.focus(); input.select(); }
      }
    });

    // Returning from Google OAuth lands here with #token=… in the fragment;
    // capture() stores it and scrubs the fragment. Never let a malformed
    // fragment (or a storage failure) block the login screen from rendering.
    try { auth.capture(); } catch (_) {}
    if (!auth.active) { this._showLogin(); return; }
    await this._postLogin();
  },
});

// Boot
document.addEventListener('DOMContentLoaded', () => state.init());

// ── Auto-sync ──────────────────────────────────────────────────────
// Flush the pending queue whenever the device regains connectivity or the tab
// returns to the foreground, so a queued sale doesn't sit until someone taps
// "Retry". Each pending item carries an idempotency key, so a re-send can never
// create a duplicate row in Goloka.
let _autoSyncing = false;
async function _autoSync() {
  if (_autoSyncing || !navigator.onLine || !auth.active || state.pendingCount === 0) return;
  _autoSyncing = true;
  try { await state.retryPending(); }
  finally { _autoSyncing = false; }
}
window.addEventListener('online', _autoSync);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') _autoSync();
});
