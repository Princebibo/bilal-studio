'use strict';

const config = require('./config');

/**
 * SERVER-AUTHORITATIVE PRICING.
 *
 * ──────────────────────────────────────────────────────────────────────
 *  The client sends SKUs and QUANTITIES. It never sends a price, a unit
 *  price, a subtotal, a shipping cost or a total. Those are derived here
 *  and nowhere else.
 * ──────────────────────────────────────────────────────────────────────
 *
 * If the browser were allowed to supply an amount, a buyer could open
 * DevTools, rewrite the request body to {"amount":"0.01"}, and legally
 * complete a PayPal order for one cent. PayPal captures whatever the
 * merchant asked for — validating the amount is entirely the merchant's
 * job. This module is that job.
 *
 * All money is INTEGER CENTS. Floating point is not a money type:
 * 0.1 + 0.2 === 0.30000000000000004, and PayPal rejects an order whose
 * breakdown does not sum exactly to its total.
 */

const { currency, shippingCents, maxQuantity } = config.pricing;

/**
 * The catalogue. Prices live here, on the server, in cents.
 *
 * Shipping is included in these prices — the storefront advertises free
 * delivery, so `shippingCents` stays 0 and the cost is carried by the unit
 * price. If that ever changes, change it HERE, never in the page.
 *
 * `tiers` is an ordered list of {minQty, unitCents}, highest minQty first.
 * It currently holds a single flat rate per product: no quantity discount
 * has been set. The mechanism is in place so adding one is a data change,
 * not a code change — e.g. { minQty: 50, unitCents: 3000 }.
 */
const CATALOGUE = {
  'nfc-card-black': {
    sku: 'nfc-card-black',
    name: 'Matte black NFC card',
    nameFr: 'Carte NFC noire mate',
    description: 'Blank high-frequency NFC card, laser-engravable matte surface.',
    tiers: [
      { minQty: 1, unitCents: 3500 },
    ],
  },
  'nfc-tag-white': {
    sku: 'nfc-tag-white',
    name: 'White NFC tag',
    nameFr: 'Étiquette NFC blanche',
    description: 'Blank rewritable NFC tag, printable white face.',
    tiers: [
      { minQty: 1, unitCents: 1500 },
    ],
  },
};

/** Unit price in cents for a SKU at a given quantity. */
function unitPriceCents(sku, quantity) {
  const product = CATALOGUE[sku];
  if (!product) return null;
  // Tiers are sorted descending so the first match is the best applicable.
  const sorted = [...product.tiers].sort((a, b) => b.minQty - a.minQty);
  const tier = sorted.find((t) => quantity >= t.minQty);
  return tier ? tier.unitCents : sorted[sorted.length - 1].unitCents;
}

/** Cents → the fixed-2dp decimal string PayPal requires ("35.00"). */
function toAmountString(cents) {
  return (cents / 100).toFixed(2);
}

/** Validate one client-supplied quantity. */
function parseQuantity(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n)) {
    return { ok: false, error: 'Quantity must be a whole number.' };
  }
  if (n < 1) return { ok: false, error: 'Quantity must be at least 1.' };
  if (n > maxQuantity) {
    return { ok: false, error: `For orders over ${maxQuantity} units, please contact us for a quote.` };
  }
  return { ok: true, quantity: n };
}

/**
 * Turn a client-supplied cart into an authoritative priced quote.
 *
 * Accepts ONLY [{ sku, quantity }]. Any `price`, `amount` or `total` in the
 * incoming objects is ignored — the caller logs those separately, because a
 * client sending one is either a stale frontend or someone probing for
 * exactly this vulnerability.
 *
 * @returns {{ok:true, quote:object} | {ok:false, error:string}}
 */
function quoteCart(rawItems) {
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    return { ok: false, error: 'Your cart is empty.' };
  }
  if (rawItems.length > Object.keys(CATALOGUE).length) {
    return { ok: false, error: 'Too many line items.' };
  }

  const seen = new Set();
  const lines = [];
  let itemTotalCents = 0;

  for (const raw of rawItems) {
    const sku = String(raw && raw.sku ? raw.sku : '').trim();
    const product = CATALOGUE[sku];
    if (!product) return { ok: false, error: 'Unknown product.' };

    // Two lines for the same SKU would let a tampered cart get a lower tier
    // twice over. One line per product.
    if (seen.has(sku)) return { ok: false, error: 'Duplicate product in cart.' };
    seen.add(sku);

    const parsed = parseQuantity(raw.quantity);
    if (!parsed.ok) return { ok: false, error: parsed.error };

    const unitCents = unitPriceCents(sku, parsed.quantity);
    const lineCents = unitCents * parsed.quantity;
    itemTotalCents += lineCents;

    lines.push({
      sku,
      name: product.name,
      nameFr: product.nameFr,
      description: product.description,
      quantity: parsed.quantity,
      unitCents,
      lineCents,
      unit: toAmountString(unitCents),
      line: toAmountString(lineCents),
    });
  }

  const totalCents = itemTotalCents + shippingCents;

  return {
    ok: true,
    quote: {
      currency,
      lines,
      itemTotalCents,
      shippingCents,
      totalCents,
      itemTotal: toAmountString(itemTotalCents),
      shipping: toAmountString(shippingCents),
      total: toAmountString(totalCents),
    },
  };
}

/**
 * Defence in depth: confirm what PayPal actually captured matches what we
 * asked for. Called from the webhook. Catches a tampered order, a currency
 * swap, a partial capture, or our own arithmetic bug.
 */
function capturedAmountMatches(stored, capturedValue, capturedCurrency) {
  if (String(capturedCurrency).toUpperCase() !== String(stored.currency).toUpperCase()) return false;
  const capturedCents = Math.round(Number(capturedValue) * 100);
  return Number.isFinite(capturedCents) && capturedCents === stored.totalCents;
}

/** Public catalogue view for the storefront — names and prices, no internals. */
function publicCatalogue() {
  return Object.values(CATALOGUE).map((p) => ({
    sku: p.sku,
    name: p.name,
    nameFr: p.nameFr,
    unitPrice: toAmountString(unitPriceCents(p.sku, 1)),
    currency,
  }));
}

module.exports = {
  CATALOGUE,
  quoteCart,
  parseQuantity,
  unitPriceCents,
  toAmountString,
  capturedAmountMatches,
  publicCatalogue,
};
