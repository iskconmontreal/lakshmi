/**
 * ISKCON Montreal Boutique — Goloka REST API client
 *
 * Per-user JWT auth (ported from sankirtan-pos): every request carries the
 * logged-in cashier's token. On a 401 the client silently refreshes and retries
 * once; if that fails the error carries `authExpired: true` so callers can queue
 * the sale and show the login step.
 *
 * Sales POST to /api/finance/counter-sale with an Idempotency-Key (one per sale)
 * so a retry can never create a duplicate.
 */

import { CONFIG } from './config.js';
import { auth } from './auth.js';
import { normalizeBillingCat } from './sales.js';

// ── Cart → API shape helpers ──────────────────────────────────────
export function toCents(dollars) {
  return Math.round((parseFloat(dollars) || 0) * 100);
}

// Build the per-sale POST body from a stored transaction. Exported because the
// sync module (offline queue + legacy migration) reuses it.
export function txToApiShape(tx) {
  const items = tx.items.map(item => {
    const cat  = normalizeBillingCat(item.category);
    const unit = cat === 'Temple Donation'
      ? (item.donation ?? item.suggestedDonation)
      : item.suggestedDonation;
    const out = {
      name:        item.name,
      qty:         item.qty,
      price_cents: toCents(unit),
      category:    cat,
    };
    if (item.id != null) out.sankirtan_book_id = item.id;
    return out;
  });
  const dueCents = items.reduce((sum, i) => sum + i.price_cents * i.qty, 0);
  return {
    occurred_at:     tx.timestamp,
    due_cents:       dueCents,
    collected_cents: toCents(tx.actualDonation),
    payment_method:  tx.paymentMethod || 'Cash',
    items,
  };
}

function groupByDate(sales) {
  // sales: array of { id, occurred_at, due_cents, collected_cents, payment_method,
  //                   temple_donation_cents, overpayment_cents, items[] }
  // sorted newest-first by the API
  const days = {};
  for (const s of sales) {
    const day = s.occurred_at.slice(0, 10);
    if (!days[day]) days[day] = [];
    const donationCents    = s.temple_donation_cents ?? 0;
    const overpaymentCents = s.overpayment_cents ?? Math.max(0, s.collected_cents - s.due_cents - donationCents);
    days[day].push({
      time:        new Date(s.occurred_at).toLocaleTimeString('en-CA', { hour: '2-digit', minute: '2-digit' }),
      method:      s.payment_method,
      collected:   '$' + (s.collected_cents / 100).toFixed(2),
      donation:    donationCents    > 0 ? '+$' + (donationCents    / 100).toFixed(2) : null,
      overpayment: overpaymentCents > 0 ? '+$' + (overpaymentCents / 100).toFixed(2) : null,
      items:       (s.items || []).map(i => ({
        name:     i.name,
        qty:      i.qty,
        price:    '$' + (i.price_cents / 100).toFixed(2),
        category: normalizeBillingCat(i.category),
      })),
      _c: s.collected_cents,
      _d: donationCents,
      _o: overpaymentCents,
      _rawItems: s.items || [],
    });
  }

  return Object.entries(days)
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([date, txs]) => {
      const d                 = new Date(date + 'T12:00:00');
      const totalCents        = txs.reduce((s, t) => s + t._c, 0);
      const donationCents     = txs.reduce((s, t) => s + t._d, 0);
      const overpaymentCents  = txs.reduce((s, t) => s + t._o, 0);
      const catCents = {};
      txs.forEach(tx => tx._rawItems.forEach(i => {
        const cat = normalizeBillingCat(i.category);
        catCents[cat] = (catCents[cat] || 0) + i.price_cents * i.qty;
      }));
      const catTotals = Object.entries(catCents)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([label, v]) => ({ label, total: '$' + (v / 100).toFixed(2) }));
      return {
        dateLabel:      d.toLocaleDateString('en-CA', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }),
        txCount:        txs.length + ' transaction' + (txs.length !== 1 ? 's' : ''),
        dayTotal:       '$' + (totalCents        / 100).toFixed(2),
        dayDonation:    donationCents    > 0 ? '+$' + (donationCents    / 100).toFixed(2) : null,
        dayOverpayment: overpaymentCents > 0 ? '+$' + (overpaymentCents / 100).toFixed(2) : null,
        catTotals,
        transactions: txs.map(({ _c, _d, _o, _rawItems, ...t }) => t),
      };
    });
}

// ── JWT request core (ported from sankirtan-pos) ──────────────────
function _base() {
  return CONFIG.GOLOKA_URL.replace(/\/$/, '');
}

function _headers(extra) {
  const h = {
    'Content-Type': 'application/json',
    'ngrok-skip-browser-warning': 'true',
    ...extra,
  };
  if (auth.token) h['Authorization'] = `Bearer ${auth.token}`;
  return h;
}

async function _shapeError(resp) {
  let msg = `HTTP ${resp.status}`;
  try { const e = await resp.json(); msg = e.error || e.message || msg; } catch (_) {}
  const err = new Error(msg);
  err.status = resp.status;
  return err;
}

// Single-flight refresh: concurrent 401s share one /auth/refresh round-trip.
let _refreshPromise = null;

async function _tryRefresh() {
  const rt = auth.refreshToken;
  if (!rt) return false;
  try {
    const resp = await fetch(`${_base()}/auth/refresh`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'ngrok-skip-browser-warning': 'true' },
      body:    JSON.stringify({ refresh_token: rt }),
    });
    if (!resp.ok) return false;
    const data = await resp.json();
    if (!data.token) return false;
    auth.save(data.token, data.user, data.refresh_token);
    return true;
  } catch (_) {
    return false;
  }
}

async function _request(path, opts = {}, retried = false) {
  const resp = await fetch(`${_base()}${path}`, {
    ...opts,
    headers: _headers(opts.headers),
  });
  if (resp.status === 401 && auth.refreshToken && !retried) {
    if (!_refreshPromise) _refreshPromise = _tryRefresh().finally(() => { _refreshPromise = null; });
    if (await _refreshPromise) return _request(path, opts, true);
    auth.clear();
    const err = new Error('Signed out — please sign in again');
    err.status = 401;
    err.authExpired = true;
    throw err;
  }
  if (resp.status === 401 || resp.status === 403) {
    const err = await _shapeError(resp);
    if (resp.status === 401) { auth.clear(); err.authExpired = true; }
    throw err;
  }
  if (!resp.ok) throw await _shapeError(resp);
  return resp;
}

// ── Public API ────────────────────────────────────────────────────
export const DB = {
  // ── Auth ──────────────────────────────────────────────

  // POST /auth/login — returns {step:'password_required'|'otp_required'} or {token,…}
  async login(email, password) {
    const resp = await _request('/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        email,
        password:     password || '',
        device_id:    auth.deviceId,
        device_label: auth.deviceLabel,
      }),
    });
    return resp.json();
  },

  // POST /auth/verify-otp — returns {token, user, refresh_token}
  async verifyOtp(email, otp) {
    const resp = await _request('/auth/verify-otp', {
      method: 'POST',
      body: JSON.stringify({
        email,
        otp,
        device_id:    auth.deviceId,
        device_label: auth.deviceLabel,
      }),
    });
    return resp.json();
  },

  // GET /auth/google — returns {url} to navigate to. The callback returns the
  // browser to this page with tokens in the URL fragment (auth.capture()).
  async googleUrl() {
    const redirect = window.location.href.split('#')[0].split('?')[0];
    const resp = await _request(`/auth/google?redirect=${encodeURIComponent(redirect)}&device_id=${encodeURIComponent(auth.deviceId)}`);
    return resp.json();
  },

  // POST /auth/logout — revoke this device's refresh token (best-effort).
  async logout() {
    try {
      await _request('/auth/logout', {
        method: 'POST',
        body: JSON.stringify({ device_id: auth.deviceId }),
      });
    } catch (_) {}
  },

  // ── Sankirtan catalog (boutique sells these books too) ─
  async getBooks() {
    const resp = await _request('/api/sankirtan/books', { cache: 'no-store' });
    return resp.json();
  },

  // ── Counter sales ─────────────────────────────────────

  // POST /api/finance/counter-sale — one sale, attributed server-side to the JWT
  // user. `idempotency_key` (required) is sent as `Idempotency-Key` so a retry
  // can't create a duplicate. Batch of exactly one, per the server contract.
  async postSale(payload, idempotency_key) {
    const resp = await _request('/api/finance/counter-sale', {
      method:  'POST',
      headers: { 'Idempotency-Key': idempotency_key },
      body:    JSON.stringify({ sales: [payload] }),
    });
    return resp.json();
  },

  // Re-push a stored sale (retry / disaster recovery). Reports whether Goloka
  // already had it via the `Idempotent-Replay: true` header.
  async repostSale(payload, idempotency_key) {
    const resp = await _request('/api/finance/counter-sale', {
      method:  'POST',
      headers: { 'Idempotency-Key': idempotency_key },
      body:    JSON.stringify({ sales: [payload] }),
    });
    return {
      result:   await resp.json(),
      replayed: resp.headers.get('Idempotent-Replay') === 'true',
    };
  },

  // GET /api/finance/counter-sale — all sales grouped by local date, newest first.
  async allSales() {
    const resp = await _request('/api/finance/counter-sale', { cache: 'no-store' });
    return groupByDate(await resp.json());
  },

  // DELETE /api/finance/counter-sale — wipe backend sales (requires boutique:manage).
  async clearAll() {
    const resp = await _request('/api/finance/counter-sale', { method: 'DELETE' });
    return resp.json();
  },

  // Lightweight authenticated ping — returns { ok, message }.
  async testConnection() {
    try {
      const resp = await _request('/api/finance/counter-sale', { cache: 'no-store' });
      const data = await resp.json();
      const n = Array.isArray(data) ? data.length : '?';
      return { ok: true, message: `✓ Connected. ${n} sale${n !== 1 ? 's' : ''} in database.` };
    } catch (err) {
      return { ok: false, message: `✗ ${err.message}` };
    }
  },
};
