/**
 * ISKCON Montreal Boutique — Configuration
 *
 * TO CONFIGURE YOUR GOOGLE SHEET:
 *   1. Create a Google Sheet with columns: Name, Category, SuggestedDonation, ImageURL, Description
 *   2. File → Share → Publish to web → Comma-separated values (.csv) → Publish
 *   3. Replace the empty string below with your published CSV URL
 *      OR paste the URL directly in the Admin panel of the app
 */

export const CONFIG = {
  // ──────────────────────────────────────────────────────────────────
  // Paste your Google Sheet CSV URL here (or set it via the Admin panel)
  GOOGLE_SHEET_CSV_URL: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vTu0XuKtw8bDCIJcjY4I7kCLLTgdhgwIuzZfC8tnW76fKJwoE5-iRFgOWr1R0fEzZrillJmVth0tUYb/pub?output=csv',
  // ──────────────────────────────────────────────────────────────────

  STORE_NAME: 'ISKCON Montreal Boutique',
  CURRENCY_SYMBOL: '$',

  STORAGE_KEYS: {
    CATALOG_CACHE: 'iskcon_catalog_cache',
    SALES:         'iskcon_sales',
    CONFIG:        'iskcon_config',
    SYNC_CURSOR:   'iskcon_sync_cursor',
  },

  // ── Goloka backend (set via Admin panel) ──────────────────────
  GOLOKA_URL:        'http://localhost:8080',//'https://api.iskconmontreal.ca',
  BOUTIQUE_WRITE_KEY: '7e3f30789acdd730f4ec006952911bf78b0821655bdbdcda',  // set once via Admin panel, stored in localStorage
};

// ──────────────────────────────────────────────────────────────────
// Sample catalog — used when no Google Sheet URL is configured
// ──────────────────────────────────────────────────────────────────
export const SAMPLE_CATALOG = [
  {
    name: 'Bhagavad Gita As It Is',
    category: 'Books',
    suggestedDonation: 25.00,
    imageURL: 'https://placehold.co/150x200/FF9933/800020?text=Gita',
    description: 'Hardcover edition',
  },
  {
    name: 'Srimad Bhagavatam Vol 1',
    category: 'Books',
    suggestedDonation: 35.00,
    imageURL: 'https://placehold.co/150x200/FF9933/800020?text=SB+Vol+1',
    description: 'First Canto',
  },
  {
    name: 'Krishna Book',
    category: 'Books',
    suggestedDonation: 20.00,
    imageURL: 'https://placehold.co/150x200/FF9933/800020?text=Krishna',
    description: 'Paperback',
  },
  {
    name: 'Science of Self Realization',
    category: 'Books',
    suggestedDonation: 15.00,
    imageURL: 'https://placehold.co/150x200/FF9933/800020?text=SSR',
    description: 'Paperback',
  },
  {
    name: 'Incense Box (Nag Champa)',
    category: 'Incense',
    suggestedDonation: 5.00,
    imageURL: 'https://placehold.co/150x200/FF9933/800020?text=Incense',
    description: '12 sticks',
  },
  {
    name: 'Sandalwood Incense',
    category: 'Incense',
    suggestedDonation: 8.00,
    imageURL: 'https://placehold.co/150x200/FF9933/800020?text=Sandal',
    description: 'Premium quality',
  },
  {
    name: 'Japa Mala Beads',
    category: 'Other',
    suggestedDonation: 15.00,
    imageURL: 'https://placehold.co/150x200/FF9933/800020?text=Mala',
    description: 'Tulsi wood, 108 beads',
  },
  {
    name: 'Tulsi Neck Beads',
    category: 'Other',
    suggestedDonation: 10.00,
    imageURL: 'https://placehold.co/150x200/FF9933/800020?text=Tulsi',
    description: 'Small size',
  },
  {
    name: 'Deity Photo (small)',
    category: 'Deities',
    suggestedDonation: 8.00,
    imageURL: 'https://placehold.co/150x200/FF9933/800020?text=Deity',
    description: 'Framed',
  },
  {
    name: 'Kurta (cotton)',
    category: 'Clothing',
    suggestedDonation: 40.00,
    imageURL: 'https://placehold.co/150x200/FF9933/800020?text=Kurta',
    description: 'White cotton',
  },
  {
    name: 'Prasadam Sweet Box',
    category: 'Food',
    suggestedDonation: 12.00,
    imageURL: 'https://placehold.co/150x200/FF9933/800020?text=Prasad',
    description: 'Assorted sweets',
  },
  {
    name: 'General Donation',
    category: 'Donations',
    suggestedDonation: 0.00,
    imageURL: 'https://placehold.co/150x200/FF9933/800020?text=Donate',
    description: 'Any amount welcome',
  },
];
