/**
 * ISKCON Montreal Boutique — Sales Module
 * Handles saving transactions, loading history, building reports.
 */

import { CONFIG } from './config.js';

function billingCategory(cat) {
  if (cat === 'Food')      return 'Restaurant';
  if (cat === 'Books')     return 'Books';
  if (cat === 'Donations') return 'Temple Donation';
  return 'Boutique'; // Incense, Deities, Clothing, Other
}

export function normalizeBillingCat(cat) {
  if (cat === 'Restaurant')      return 'Restaurant';
  if (cat === 'Temple Donation') return 'Temple Donation';
  if (cat === 'Books')           return 'Books';
  if (cat === 'Food')            return 'Restaurant';      // raw catalog value
  if (cat === 'Donations')       return 'Temple Donation'; // raw catalog value
  return 'Boutique'; // undefined, '', 'Boutique', 'Incense', 'Deities', 'Clothing', 'Other'
}

export const Sales = {

  // ── Transactions ─────────────────────────────────────────────────

  /**
   * Record a completed sale.
   * @param {Array}  cartItems       - Cart item array at time of sale
   * @param {number} suggestedTotal  - Sum of suggested donations
   * @param {number} actualDonation  - Amount actually received
   * @param {string} paymentMethod   - 'Cash' or 'Card'
   * @returns {{ timestamp, items, suggestedTotal, actualDonation, paymentMethod }}
   */
  record(cartItems, suggestedTotal, actualDonation, paymentMethod) {
    const tx = {
      timestamp:      new Date().toISOString(),
      items:          cartItems.map(i => ({
        name:              i.name,
        suggestedDonation: i.suggestedDonation,
        qty:               i.qty,
        category:          billingCategory(i.category),
      })),
      suggestedTotal:  +suggestedTotal.toFixed(2),
      actualDonation:  +actualDonation.toFixed(2),
      paymentMethod:   paymentMethod || 'Cash',
    };
    const all = Sales._loadAll();
    all.push(tx);
    Sales._saveAll(all);
    return tx;
  },

  /** Return all transactions for today (local date). */
  getToday() {
    const todayKey = Sales._todayKey();
    return Sales._loadAll().filter(tx => Sales._localDateKey(tx.timestamp) === todayKey);
  },

  /** Return all transactions for a given YYYY-MM-DD date key. */
  getByDate(dateKey) {
    return Sales._loadAll().filter(tx => Sales._localDateKey(tx.timestamp) === dateKey);
  },

  /** Delete today's transactions. */
  clearToday() {
    const key = Sales._todayKey();
    const remaining = Sales._loadAll().filter(tx => tx.timestamp.slice(0, 10) !== key);
    Sales._saveAll(remaining);
  },

  /** Delete all sales and catalog cache. */
  clearAll() {
    localStorage.removeItem(CONFIG.STORAGE_KEYS.SALES);
    localStorage.removeItem(CONFIG.STORAGE_KEYS.CATALOG_CACHE);
  },

  // ── Reporting ────────────────────────────────────────────────────

  /**
   * Build a summary object from an array of transactions.
   * @param {Array} transactions
   * @returns {{ count, items, suggestedTotal, actualTotal, difference, percentage, byPayment }}
   */
  buildSummary(transactions) {
    const itemMap   = {};
    const byPayment = { Cash: { count: 0, total: 0 }, Card: { count: 0, total: 0 } };
    const byCategory = {};
    let suggestedTotal = 0;
    let actualTotal    = 0;

    transactions.forEach(tx => {
      suggestedTotal += tx.suggestedTotal;
      actualTotal    += tx.actualDonation;

      // Payment method breakdown (handle legacy records that lack the field)
      const method = tx.paymentMethod || 'Cash';
      if (!byPayment[method]) byPayment[method] = { count: 0, total: 0 };
      byPayment[method].count += 1;
      byPayment[method].total += tx.actualDonation;

      tx.items.forEach(item => {
        if (!itemMap[item.name]) {
          itemMap[item.name] = { name: item.name, qty: 0, suggested: 0, category: normalizeBillingCat(item.category) };
        }
        itemMap[item.name].qty       += item.qty;
        itemMap[item.name].suggested += item.suggestedDonation * item.qty;

        // Category revenue breakdown (skip Temple Donation — allocated per-tx below)
        const cat = normalizeBillingCat(item.category);
        if (cat !== 'Temple Donation') {
          byCategory[cat] = (byCategory[cat] || 0) + item.suggestedDonation * item.qty;
        }
      });

      // Allocate Temple Donation revenue = actual minus all non-donation items
      const hasDonationItem = tx.items.some(i => normalizeBillingCat(i.category) === 'Temple Donation');
      if (hasDonationItem) {
        const nonDonationTotal = tx.items
          .filter(i => normalizeBillingCat(i.category) !== 'Temple Donation')
          .reduce((s, i) => s + i.suggestedDonation * i.qty, 0);
        const donationAmt = Math.max(0, tx.actualDonation - nonDonationTotal);
        byCategory['Temple Donation'] = (byCategory['Temple Donation'] || 0) + donationAmt;
      }
    });

    // Round payment and category totals
    Object.values(byPayment).forEach(p => { p.total = +p.total.toFixed(2); });
    Object.keys(byCategory).forEach(k => { byCategory[k] = +byCategory[k].toFixed(2); });

    const items      = Object.values(itemMap).sort((a, b) => a.name.localeCompare(b.name));
    const difference = actualTotal - suggestedTotal;
    const percentage = suggestedTotal > 0
      ? parseFloat(((difference / suggestedTotal) * 100).toFixed(1))
      : null;

    return {
      count: transactions.length,
      items,
      suggestedTotal: +suggestedTotal.toFixed(2),
      actualTotal:    +actualTotal.toFixed(2),
      difference:     +difference.toFixed(2),
      percentage,
      byPayment,
      byCategory,
    };
  },

  /**
   * Return summaries for the last N days that have any sales.
   * @param {number} limit - Max days to return (default 7)
   */
  getRecentDays(limit = 7) {
    const all  = Sales._loadAll();
    const days = {};

    all.forEach(tx => {
      const day = Sales._localDateKey(tx.timestamp);
      if (!days[day]) days[day] = [];
      days[day].push(tx);
    });

    return Object.entries(days)
      .sort(([a], [b]) => b.localeCompare(a))
      .slice(0, limit)
      .map(([date, txs]) => ({ date, ...Sales.buildSummary(txs) }));
  },

  // ── localStorage helpers ─────────────────────────────────────────

  _loadAll() {
    try {
      const raw = localStorage.getItem(CONFIG.STORAGE_KEYS.SALES);
      return raw ? JSON.parse(raw) : [];
    } catch (_) { return []; }
  },

  _saveAll(arr) {
    try {
      localStorage.setItem(CONFIG.STORAGE_KEYS.SALES, JSON.stringify(arr));
    } catch (_) { console.warn('[Sales] Could not save — localStorage quota?'); }
  },

  _todayKey() {
    return Sales._localDateKey(new Date().toISOString());
  },

  // Extract the LOCAL calendar date from a UTC ISO timestamp string
  _localDateKey(isoTimestamp) {
    const d = new Date(isoTimestamp);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  },
};
