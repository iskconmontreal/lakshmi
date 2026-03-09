/**
 * ISKCON Montreal Boutique — Goloka REST API client
 *
 * POSTs new transactions to POST /api/boutique/sales (write key protected).
 * Reads history from  GET  /api/boutique/sales (public).
 */

import { CONFIG } from './config.js';
import { normalizeBillingCat } from './sales.js';

// ── Helpers ───────────────────────────────────────────────────────
function toCents(dollars) {
  return Math.round((parseFloat(dollars) || 0) * 100);
}


function txToApiShape(tx) {
  return {
    occurred_at:     tx.timestamp,
    due_cents:       toCents(tx.suggestedTotal),
    collected_cents: toCents(tx.actualDonation),
    payment_method:  tx.paymentMethod || 'Cash',
    items: tx.items.map(item => ({
      name:        item.name,
      qty:         item.qty,
      price_cents: toCents(item.suggestedDonation),
      category:    normalizeBillingCat(item.category),
    })),
  };
}


function groupByDate(sales) {
  // sales: array of { id, occurred_at, due_cents, collected_cents, payment_method, items[] }
  // sorted newest-first by the API
  const days = {};
  for (const s of sales) {
    const day = s.occurred_at.slice(0, 10);
    if (!days[day]) days[day] = [];
    const donationCents = Math.max(0, s.collected_cents - s.due_cents);
    days[day].push({
      time:      new Date(s.occurred_at).toLocaleTimeString('en-CA', { hour: '2-digit', minute: '2-digit' }),
      method:    s.payment_method,
      collected: '$' + (s.collected_cents / 100).toFixed(2),
      donation:  donationCents > 0 ? '+$' + (donationCents / 100).toFixed(2) : null,
      items:     (s.items || []).map(i => ({
        name:     i.name,
        qty:      i.qty,
        price:    '$' + (i.price_cents / 100).toFixed(2),
        category: normalizeBillingCat(i.category),
      })),
      _c: s.collected_cents,
      _d: donationCents,
      _rawItems: s.items || [],
    });
  }

  return Object.entries(days)
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([date, txs]) => {
      const d            = new Date(date + 'T12:00:00');
      const totalCents   = txs.reduce((s, t) => s + t._c, 0);
      const donationCents = txs.reduce((s, t) => s + t._d, 0);
      const catCents = {};
      txs.forEach(tx => tx._rawItems.forEach(i => {
        const cat = normalizeBillingCat(i.category);
        catCents[cat] = (catCents[cat] || 0) + i.price_cents * i.qty;
      }));
      const catTotals = Object.entries(catCents)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([label, v]) => ({ label, total: '$' + (v / 100).toFixed(2) }));
      return {
        dateLabel:   d.toLocaleDateString('en-CA', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }),
        txCount:     txs.length + ' transaction' + (txs.length !== 1 ? 's' : ''),
        dayTotal:    '$' + (totalCents / 100).toFixed(2),
        dayDonation: donationCents > 0 ? '+$' + (donationCents / 100).toFixed(2) : null,
        catTotals,
        transactions: txs.map(({ _c, _d, _rawItems, ...t }) => t),
      };
    });
}

// ── Public API ────────────────────────────────────────────────────
export const DB = {

  isConfigured() {
    return !!(CONFIG.GOLOKA_URL && CONFIG.BOUTIQUE_WRITE_KEY);
  },

  /**
   * Append new transactions to the Goloka database.
   * Caller passes only transactions not yet synced (delta since sync cursor).
   * @returns {{ count, cursor }}
   */
  async appendNew(newTxs) {
    if (newTxs.length === 0) return { count: 0 };
    const res = await fetch(`${CONFIG.GOLOKA_URL}/api/boutique/sales`, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${CONFIG.BOUTIQUE_WRITE_KEY}`,
      },
      body: JSON.stringify({ sales: newTxs.map(txToApiShape) }),
    });
    if (!res.ok) throw new Error(`API error ${res.status}`);
    const json = await res.json();
    const last = newTxs[newTxs.length - 1].timestamp;
    return { count: json.count, cursor: last };
  },

  /**
   * Return all sales grouped by local date, newest first.
   * Each day: { dateLabel, txCount, transactions[] }
   */
  async allSales() {
    const res = await fetch(`${CONFIG.GOLOKA_URL}/api/boutique/sales`);
    if (!res.ok) throw new Error(`API error ${res.status}`);
    return groupByDate(await res.json());
  },

  /**
   * Delete all sales from the backend database. Write-key protected. For testing only.
   */
  async clearAll() {
    const res = await fetch(`${CONFIG.GOLOKA_URL}/api/boutique/sales`, {
      method:  'DELETE',
      headers: { 'Authorization': `Bearer ${CONFIG.BOUTIQUE_WRITE_KEY}` },
    });
    if (!res.ok) throw new Error(`API error ${res.status}`);
    return res.json();
  },

  /**
   * Test the Goloka connection. Returns { ok, message }.
   */
  async testConnection() {
    const { GOLOKA_URL, BOUTIQUE_WRITE_KEY } = CONFIG;
    if (!GOLOKA_URL || !BOUTIQUE_WRITE_KEY) {
      return { ok: false, message: 'Goloka URL and write key are required.' };
    }
    try {
      const res = await fetch(`${GOLOKA_URL}/api/boutique/sales`);
      if (!res.ok) return { ok: false, message: `✗ API error ${res.status}` };
      const data = await res.json();
      const n = Array.isArray(data) ? data.length : '?';
      return { ok: true, message: `✓ Connected. ${n} sale${n !== 1 ? 's' : ''} in database.` };
    } catch (err) {
      return { ok: false, message: `✗ ${err.message}` };
    }
  },
};
