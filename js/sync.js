/* Lakshmi Boutique POS — Sync Module
   Owns the durable offline-sync state (ported from sankirtan-pos sessions.js):
   a pending queue of sales that failed to POST, and a durable archive of every
   sale Goloka has acked (so we can re-push after a backend crash/restore).

   The live cart lives in cart.js and the local reporting store in sales.js — this
   module only tracks what still needs to reach Goloka, keyed by idempotency key.
*/

import { CONFIG } from './config.js';
import { Sales } from './sales.js';
import { txToApiShape } from './db.js';

const K = CONFIG.STORAGE_KEYS;

function _newKey() {
  return (crypto && crypto.randomUUID) ? crypto.randomUUID()
    : 'k_' + Date.now() + '_' + Math.random().toString(36).slice(2);
}

export const Sync = {
  newKey: _newKey,

  // ── Pending (failed) submissions ──────────────────────

  // `user_id` stamps the queued sale with its owner so a shared tablet can't
  // flush someone else's sale under the wrong account (Goloka attributes every
  // submission to whoever holds the JWT).
  savePending(payload, idempotency_key, user_id) {
    const pending = Sync.getPending();
    pending.push({
      id: _newKey(), // UUID — removePending() deletes by exact id, so ids must never collide
      payload,
      idempotency_key: idempotency_key || _newKey(),
      user_id: user_id || null,
      saved_at: new Date().toISOString(),
    });
    try { localStorage.setItem(K.PENDING, JSON.stringify(pending)); }
    catch (_) {}
  },

  getPending() {
    try {
      const raw = localStorage.getItem(K.PENDING);
      return raw ? JSON.parse(raw) : [];
    } catch (_) { return []; }
  },

  removePending(id) {
    const filtered = Sync.getPending().filter(p => p.id !== id);
    try { localStorage.setItem(K.PENDING, JSON.stringify(filtered)); }
    catch (_) {}
  },

  // ── Submitted archive (durable) ───────────────────────
  // Every acked sale is KEPT on the device (payload + idempotency key), so the
  // POS can always re-push ALL sales after a Goloka crash/restore. Goloka's
  // idempotency keys make re-pushes duplicate-safe. Never pruned by age; only a
  // high safety cap protects the storage quota — pruning is reported, never silent.

  ARCHIVE_CAP: 1000,

  saveRecent(result, payload, idempotency_key) {
    const recent = Sync.getRecent();
    recent.unshift({ ...result, payload, idempotency_key, saved_at: new Date().toISOString() });
    let entries = recent.slice(0, Sync.ARCHIVE_CAP);
    let status  = entries.length < recent.length ? 'pruned' : 'ok';
    try {
      localStorage.setItem(K.RECENT, JSON.stringify(entries));
      return status;
    } catch (_) {
      // Quota hit — drop the oldest half rather than lose the new sale.
      try {
        entries = entries.slice(0, Math.ceil(entries.length / 2));
        localStorage.setItem(K.RECENT, JSON.stringify(entries));
        return 'pruned';
      } catch (_) { return 'error'; }
    }
  },

  getRecent() {
    try {
      const raw = localStorage.getItem(K.RECENT);
      return raw ? JSON.parse(raw) : [];
    } catch (_) { return []; }
  },

  // True if this key is already recorded somewhere durable (queued or archived).
  hasRecordOf(idempotency_key) {
    if (!idempotency_key) return false;
    return Sync.getPending().some(p => p.idempotency_key === idempotency_key)
        || Sync.getRecent().some(r => r.idempotency_key === idempotency_key);
  },

  // ── One-time legacy migration ─────────────────────────
  // Before per-user auth, sales synced via a timestamp cursor (iskcon_sync_cursor)
  // and any sale after the cursor was still unsynced. Convert those into pending
  // queue items (fresh keys, user_id:null so the first signed-in cashier flushes
  // them) exactly once, then retire the cursor. Already-synced history stays in
  // iskcon_sales (the reporting store) and is NOT back-filled into the archive —
  // Goloka has those rows without our keys, so re-pushing them would duplicate.
  // Returns the number of sales queued.
  migrateLegacy() {
    if (localStorage.getItem(K.SYNC_MIGRATED)) return 0;

    const cursor = localStorage.getItem('iskcon_sync_cursor') || '';
    let queued = 0;
    try {
      const all = Sales._loadAll()
        .filter(tx => tx && tx.timestamp && tx.timestamp > cursor)
        .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
      for (const tx of all) {
        Sync.savePending(txToApiShape(tx), _newKey(), null);
        queued++;
      }
    } catch (_) {}

    localStorage.removeItem('iskcon_sync_cursor');
    localStorage.setItem(K.SYNC_MIGRATED, '1');
    return queued;
  },
};
