/**
 * ISKCON Montreal Boutique — Goloka REST API client
 *
 * POSTs new transactions to POST /api/finance/counter-sale (write key protected).
 * Reads history from  GET  /api/finance/counter-sale (public).
 */

import { CONFIG } from './config.js';
import { normalizeBillingCat } from './sales.js';

// ── Helpers ───────────────────────────────────────────────────────
function toCents(dollars) {
  return Math.round((parseFloat(dollars) || 0) * 100);
}


function txToApiShape(tx) {
  const items = tx.items.map(item => {
    const cat  = normalizeBillingCat(item.category);
    const unit = cat === 'Temple Donation'
      ? (item.donation ?? item.suggestedDonation)
      : item.suggestedDonation;
    return {
      name:        item.name,
      qty:         item.qty,
      price_cents: toCents(unit),
      category:    cat,
    };
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
    const res = await fetch(`${CONFIG.GOLOKA_URL}/api/finance/counter-sale`, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${CONFIG.BOUTIQUE_WRITE_KEY}`,
      },
      body: JSON.stringify({ sales: newTxs.map(txToApiShape) }),
    });
    if (!res.ok) throw new Error(`API error ${res.status}`);
    await res.json();
    const last = newTxs[newTxs.length - 1].timestamp;
    return { count: newTxs.length, cursor: last };
  },

  /**
   * Return all sales grouped by local date, newest first.
   * Each day: { dateLabel, txCount, transactions[] }
   */
  async allSales() {
    const res = await fetch(`${CONFIG.GOLOKA_URL}/api/finance/counter-sale`);
    if (!res.ok) throw new Error(`API error ${res.status}`);
    return groupByDate(await res.json());
  },

  /**
   * Delete all sales from the backend database. Write-key protected. For testing only.
   */
  async clearAll() {
    const res = await fetch(`${CONFIG.GOLOKA_URL}/api/finance/counter-sale`, {
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
      const res = await fetch(`${GOLOKA_URL}/api/finance/counter-sale`);
      if (!res.ok) return { ok: false, message: `✗ API error ${res.status}` };
      const data = await res.json();
      const n = Array.isArray(data) ? data.length : '?';
      return { ok: true, message: `✓ Connected. ${n} sale${n !== 1 ? 's' : ''} in database.` };
    } catch (err) {
      return { ok: false, message: `✗ ${err.message}` };
    }
  },
};
