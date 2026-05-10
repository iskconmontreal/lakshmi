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
    const savedConfig = Catalog._loadConfig();
    const sheetUrl = savedConfig.sheetUrl || CONFIG.GOOGLE_SHEET_CSV_URL;

    if (sheetUrl) {
      // Clear cache if forcing a refresh
      if (force) {
        localStorage.removeItem(CONFIG.STORAGE_KEYS.CATALOG_CACHE);
      }

      // Try cached version first (when not forcing)
      if (!force) {
        const cached = Catalog._readCache();
        if (cached) {
          Catalog.items = cached;
          return { source: 'cache', count: cached.length };
        }
      }

      // Fetch from Google Sheet
      try {
        const items = await Catalog._fetchSheet(sheetUrl);
        Catalog.items = items;
        Catalog._writeCache(items);
        return { source: 'sheet', count: items.length };
      } catch (err) {
        console.warn('[Catalog] Sheet fetch failed:', err.message);
        // Fall through to try cache one more time
        const cached = Catalog._readCache();
        if (cached) {
          Catalog.items = cached;
          return { source: 'cache', count: cached.length };
        }
      }
    }

    // No sheet URL or fetch failed and no cache → sample data
    Catalog.items = SAMPLE_CATALOG.slice();
    return { source: 'sample', count: Catalog.items.length };
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
   * @param {string} query  - Text search
   * @param {string} cat    - Category name or 'All'
   * @returns {Array}
   */
  filter(query, cat) {
    const q = (query || '').toLowerCase().trim();
    return Catalog.items.filter(item => {
      const matchesQ   = !q || item.name.toLowerCase().includes(q) ||
                                (item.description || '').toLowerCase().includes(q);
      const matchesCat = !cat || cat === 'All' || item.category === cat
                         || (cat === 'Books' && item.category === 'Sankirtan Books');
      return matchesQ && matchesCat;
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

  _loadConfig() {
    try {
      return JSON.parse(localStorage.getItem(CONFIG.STORAGE_KEYS.CONFIG) || '{}');
    } catch (_) { return {}; }
  },
};
