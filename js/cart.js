/**
 * ISKCON Montreal Boutique — Cart Module
 * Pure data layer: manages cart item state only.
 * Rendering is handled by Sprae state in state.js.
 */

export const Cart = {
  /** @type {{ name: string, category: string, suggestedDonation: number, qty: number, imageURL: string }[]} */
  items: [],

  /** Add one unit of a product. If already in cart, increment qty. */
  add(product) {
    const existing = Cart.items.find(i => i.name === product.name);
    if (existing) {
      existing.qty += 1;
    } else {
      Cart.items.push({
        name:              product.name,
        category:          product.category,
        suggestedDonation: product.suggestedDonation,
        donation:          product.suggestedDonation, // cashier-editable unit price
        qty:               1,
        imageURL:          product.imageURL || '',
      });
    }
  },

  /** Remove an item completely from the cart. */
  remove(name) {
    Cart.items = Cart.items.filter(i => i.name !== name);
  },

  /** Set the quantity for an item. qty <= 0 removes the item. */
  setQty(name, qty) {
    if (qty <= 0) { Cart.remove(name); return; }
    const item = Cart.items.find(i => i.name === name);
    if (item) item.qty = qty;
  },

  /** Clear the entire cart. */
  clear() {
    Cart.items = [];
  },

  /** Return the sum of (suggestedDonation × qty) for all cart items. */
  getSuggestedTotal() {
    return Cart.items.reduce((sum, i) => sum + i.suggestedDonation * i.qty, 0);
  },
};
