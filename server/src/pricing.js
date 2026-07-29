'use strict';

const config = require('./config');

/**
 * SERVER-AUTHORITATIVE PRICING.
 *
 * ──────────────────────────────────────────────────────────────────────
 *  The client sends a QUANTITY. It never sends a price, a unit price,
 *  a subtotal, or a total. Those are derived here and nowhere else.
 * ──────────────────────────────────────────────────────────────────────
 *
 * If the browser were allowed to supply an amount, a buyer could open
 * DevTools, rewrite the request body to `{"amount":"0.01"}`, and legally
 * complete a PayPal order for one cent. PayPal will happily capture
 * whatever the merchant asked for — validating the amount is entirely
 * the merchant's job. This module is that job.
 *
 * All money is handled as INTEGER CENTS. Floating point is not a money
 * type: 0.1 + 0.2 === 0.30000000000000004, and PayPal rejects amounts
 * whose breakdown does not sum exactly to the total.
 */

const { tiers, shippingCents, currency, maxQuantity } = config.pricing;

/** Unit price in cents for a given quantity. More cards, cheaper each. */
function unitPriceCents(quantity) {
  if (quantity >= 10) return tiers.tenPlus;     // $30
  if (quantity >= 5) return tiers.fiveToNine;   // $35
  if (quantity >= 2) return tiers.twoToFour;    // $40
  return tiers.one;                             // $45
}

/** Cents → the fixed-2dp decimal string PayPal requires ("45.00"). */
function toAmountString(cents) {
  return (cents / 100).toFixed(2);
}

/**
 * Validate a client-supplied quantity.
 * Rejects non-integers, zero, negatives, and absurd bulk values.
 * @returns {{ok: true, quantity: number} | {ok: false, error: string}}
 */
function parseQuantity(raw) {
  const n = Number(raw);

  if (!Number.isFinite(n) || !Number.isInteger(n)) {
    return { ok: false, error: 'Quantity must be a whole number.' };
  }
  if (n < 1) {
    return { ok: false, error: 'Quantity must be at least 1.' };
  }
  if (n > maxQuantity) {
    return { ok: false, error: `For orders over ${maxQuantity} cards, please contact us for a custom quote.` };
  }
  return { ok: true, quantity: n };
}

/**
 * Build the authoritative price breakdown for an order.
 *
 * Returns integer cents alongside PayPal-ready decimal strings so callers
 * never have to do their own arithmetic (and so no caller can get it wrong).
 */
function quote(quantity) {
  const unitCents = unitPriceCents(quantity);
  const itemTotalCents = unitCents * quantity;
  const totalCents = itemTotalCents + shippingCents;

  return {
    currency,
    quantity,
    unitCents,
    itemTotalCents,
    shippingCents,
    totalCents,
    // Pre-formatted strings for the PayPal Orders v2 payload.
    unit: toAmountString(unitCents),
    itemTotal: toAmountString(itemTotalCents),
    shipping: toAmountString(shippingCents),
    total: toAmountString(totalCents),
  };
}

/**
 * Defence in depth: confirm the amount PayPal actually captured matches
 * what we asked for. Called from the webhook handler.
 *
 * Catches a mismatched capture regardless of cause — a tampered order, a
 * currency swap, a partial capture, or our own arithmetic bug.
 */
function capturedAmountMatches(quote_, capturedValue, capturedCurrency) {
  if (String(capturedCurrency).toUpperCase() !== quote_.currency) return false;
  const capturedCents = Math.round(Number(capturedValue) * 100);
  return Number.isFinite(capturedCents) && capturedCents === quote_.totalCents;
}

module.exports = {
  parseQuantity,
  quote,
  unitPriceCents,
  toAmountString,
  capturedAmountMatches,
};
