/**
 * ISKCON Montreal Boutique — Catalog Module
 * Handles fetching, parsing, and caching the product catalog.
 */

import { CONFIG, SAMPLE_CATALOG } from './config.js';

export const Catalog = {
  /** Currently loaded items */
  items: [],

  /**
   * Load catalog.
   * Priority: Google Sheet URL → localStorage cache → sample data
   * @param {boolean} force - Skip cache and always fetch from sheet
   * @returns {{ source: string, count: number }}
   */
  async load(force = false) {
    // Always kick off a fresh Goloka fetch; fall back to its own cache on failure.
    const sankirtanPromise = Catalog._fetchSankirtanBooks()
      .then(items => {
        // Always overwrite the cache with the freshest list, even if empty,
        // so a deactivation propagates correctly on the next offline reload.
        Catalog._writeSankirtanCache(items);
        return items;
      })
      .catch(err => {
        console.warn('[Catalog] Sankirtan fetch failed:', err.message);
        return Catalog._readSankirtanCache() || [];
      });

    // Sheet: cache-first unless force.
    const savedConfig = Catalog._loadConfig();
    const sheetUrl    = savedConfig.sheetUrl || CONFIG.GOOGLE_SHEET_CSV_URL;
    if (force) localStorage.removeItem(CONFIG.STORAGE_KEYS.CATALOG_CACHE);
    const cachedSheet = force ? null : Catalog._readCache();

    let sheetItems = [];
    if (cachedSheet) {
      // Strip any sankirtan rows left in the legacy merged cache so they don't
      // duplicate the fresh Goloka items we're about to layer on.
      sheetItems = cachedSheet.filter(i => i.category !== 'Sankirtan Books');
    } else if (sheetUrl) {
      try {
        sheetItems = await Catalog._fetchSheet(sheetUrl);
        Catalog._writeCache(sheetItems);
      } catch (err) {
        console.warn('[Catalog] Sheet fetch failed:', err.message);
        const fallback = Catalog._readCache();
        sheetItems = fallback ? fallback.filter(i => i.category !== 'Sankirtan Books') : [];
      }
    }

    const sankirtanItems = await sankirtanPromise;
    const merged = [...sheetItems, ...sankirtanItems];

    if (merged.length === 0) {
      Catalog.items = SAMPLE_CATALOG.slice();
      return { source: 'sample', count: Catalog.items.length };
    }

    Catalog.items = merged;
    const parts = [];
    if (sheetItems.length)     parts.push(cachedSheet ? 'sheet-cache' : 'sheet');
    if (sankirtanItems.length) parts.push('goloka');
    return { source: parts.join('+'), count: merged.length };
  },

  /**
   * Fetch sankirtan books from Goloka. Returns items in the same shape as
   * the Sheet parser, with extra `id`, `language`, and `stock` fields.
   * @returns {Promise<Array>}
   */
  async _fetchSankirtanBooks() {
    if (!CONFIG.GOLOKA_URL || !CONFIG.BOUTIQUE_WRITE_KEY) return [];
    const res = await fetch(`${CONFIG.GOLOKA_URL}/api/sankirtan/books`, {
      headers: { 'Authorization': `Bearer ${CONFIG.BOUTIQUE_WRITE_KEY}` },
      cache:   'no-store',
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const books = await res.json();
    return (books || [])
      .filter(b => b.active === true && b.boutique_price_cents > 0)
      .map(b => ({
        id:                b.id,
        name:              b.title,
        language:          b.language || '',
        category:          'Sankirtan Books',
        suggestedDonation: b.boutique_price_cents / 100,
        stock:             b.stock,
        imageURL:          '',
        description:       '',
      }));
  },

  /**
   * Fetch and parse CSV from a published Google Sheet URL.
   * @param {string} url
   * @returns {Promise<Array>}
   */
  async _fetchSheet(url) {
    const resp = await fetch(url, { cache: 'no-store' });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const text = await resp.text();
    return Catalog._parseCSV(text);
  },

  /**
   * Parse CSV text into an array of product objects.
   * Handles quoted fields and BOM.
   * @param {string} text
   * @returns {Array}
   */
  _parseCSV(text) {
    const lines = text.trim().split(/\r?\n/);
    if (lines.length < 2) return [];

    // Parse header row; strip BOM and whitespace
    const headers = Catalog._parseLine(lines[0]).map(h =>
      h.trim().replace(/^\uFEFF/, '').toLowerCase()
    );

    const idx = {
      name:     headers.indexOf('name'),
      category: headers.indexOf('category'),
      donation: headers.indexOf('price') >= 0
        ? headers.indexOf('price')
        : headers.indexOf('suggesteddonation'),
      image:    headers.indexOf('imageurl'),
      desc:     headers.indexOf('description'),
    };

    const items = [];
    for (let i = 1; i < lines.length; i++) {
      const cols = Catalog._parseLine(lines[i]);
      const name = idx.name >= 0 ? (cols[idx.name] || '').trim() : '';
      if (!name) continue;

      items.push({
        name,
        category:          idx.category >= 0 ? (cols[idx.category] || 'Other').trim() : 'Other',
        suggestedDonation: idx.donation >= 0 ? (parseFloat(cols[idx.donation]) || 0) : 0,
        imageURL:          idx.image    >= 0 ? (cols[idx.image]    || '').trim()  : '',
        description:       idx.desc     >= 0 ? (cols[idx.desc]     || '').trim()  : '',
      });
    }
    return items;
  },

  /**
   * Parse a single CSV line, respecting quoted fields.
   * @param {string} line
   * @returns {string[]}
   */
  _parseLine(line) {
    const fields = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') {
          // Escaped double-quote inside a quoted field
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (ch === ',' && !inQuotes) {
        fields.push(current);
        current = '';
      } else {
        current += ch;
      }
    }
    fields.push(current);
    return fields;
  },

  /**
   * Return filtered catalog items.
   * @param {string} query  - Text search (matches name, description, and language)
   * @param {string} cat    - Category name or 'All'
   * @param {string} [lang] - Language name (sankirtan books only) or 'All'
   * @returns {Array}
   */
  filter(query, cat, lang) {
    const q = (query || '').toLowerCase().trim();
    return Catalog.items.filter(item => {
      const matchesQ    = !q || item.name.toLowerCase().includes(q) ||
                                 (item.description || '').toLowerCase().includes(q) ||
                                 (item.language    || '').toLowerCase().includes(q);
      const matchesCat  = !cat  || cat  === 'All' || item.category === cat
                          || (cat === 'Books' && item.category === 'Sankirtan Books');
      const matchesLang = !lang || lang === 'All' || !item.language || item.language === lang;
      return matchesQ && matchesCat && matchesLang;
    });
  },

  // ── localStorage helpers ─────────────────────────────────────────

  _writeCache(items) {
    try {
      localStorage.setItem(CONFIG.STORAGE_KEYS.CATALOG_CACHE, JSON.stringify({
        ts: Date.now(),
        items,
      }));
    } catch (_) { /* quota exceeded – ignore */ }
  },

  _readCache() {
    try {
      const raw = localStorage.getItem(CONFIG.STORAGE_KEYS.CATALOG_CACHE);
      if (!raw) return null;
      const { items } = JSON.parse(raw);
      return Array.isArray(items) && items.length > 0 ? items : null;
    } catch (_) { return null; }
  },

  _writeSankirtanCache(items) {
    try {
      localStorage.setItem(CONFIG.STORAGE_KEYS.SANKIRTAN_CACHE, JSON.stringify({
        ts: Date.now(),
        items,
      }));
    } catch (_) { /* quota exceeded – ignore */ }
  },

  _readSankirtanCache() {
    try {
      const raw = localStorage.getItem(CONFIG.STORAGE_KEYS.SANKIRTAN_CACHE);
      if (!raw) return null;
      const { items } = JSON.parse(raw);
      return Array.isArray(items) && items.length > 0 ? items : null;
    } catch (_) { return null; }
  },

  _loadConfig() {
    try {
      return JSON.parse(localStorage.getItem(CONFIG.STORAGE_KEYS.CONFIG) || '{}');
    } catch (_) { return {}; }
  },
};
