'use strict';

const express = require('express');
const rateLimit = require('express-rate-limit');

const logger = require('../logger');
const paypal = require('../paypal');
const pricing = require('../pricing');
const orderStore = require('../orderStore');

const router = express.Router();

const checkoutLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,                 // higher than leads: retries are normal in checkout
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { ok: false, error: 'Too many checkout attempts. Please wait a moment.' },
});

/**
 * GET /api/catalogue
 *
 * Names and unit prices for the storefront, so prices are not hardcoded in
 * two places and cannot drift apart. This is a READ of the same table the
 * server charges from — it is not an input to pricing. The client still only
 * ever sends SKUs and quantities.
 */
router.get('/catalogue', (req, res) => {
  res.json({ ok: true, products: pricing.publicCatalogue() });
});

/**
 * POST /api/quote
 *
 * Body: { items: [{ sku, quantity }] }
 *
 * Prices a cart without creating a PayPal order, so the page can show a
 * running total that is computed by the same code that will charge the card.
 * A total displayed by the browser and a total charged by the server must
 * never come from two different places.
 */
router.post('/quote', checkoutLimiter, (req, res) => {
  const result = pricing.quoteCart(req.body && req.body.items);
  if (!result.ok) return res.status(422).json({ ok: false, error: result.error });

  const q = result.quote;
  res.json({
    ok: true,
    quote: {
      currency: q.currency,
      lines: q.lines.map((l) => ({
        sku: l.sku, name: l.name, nameFr: l.nameFr,
        quantity: l.quantity, unit: l.unit, line: l.line,
      })),
      itemTotal: q.itemTotal,
      shipping: q.shipping,
      total: q.total,
    },
  });
});

/**
 * POST /api/create-paypal-order
 *
 * Body: { items: [{ sku, quantity }], customer?: { fullName, email } }
 * Returns: { ok: true, orderId, referenceId, summary }
 *
 * ── No amount is accepted from the client ──────────────────────────────
 * Only SKUs and quantities are read. Everything monetary comes from
 * pricing.quoteCart(). A request carrying `amount`, `total` or `price` is
 * ignored and logged — a client sending one is either a stale frontend or
 * somebody probing for exactly this vulnerability.
 */
router.post('/create-paypal-order', checkoutLimiter, async (req, res) => {
  const body = req.body || {};

  if (body.amount != null || body.total != null || body.price != null) {
    logger.warn('Client sent a price field to create-paypal-order — ignored', {
      ip: req.ip, sent: { amount: body.amount, total: body.total, price: body.price },
    });
  }

  const priced = pricing.quoteCart(body.items);
  if (!priced.ok) return res.status(422).json({ ok: false, error: priced.error });

  const quote = priced.quote;
  const referenceId = paypal.newReferenceId('NFC');
  const customer = body.customer || {};

  try {
    const order = await paypal.createOrder({ quote, customer, referenceId });

    /**
     * Persist the authoritative quote BEFORE returning. The webhook arrives
     * later and out of band; without this record it has nothing to compare
     * the captured amount against.
     */
    orderStore.put(referenceId, {
      referenceId,
      paypalOrderId: order.id,
      currency: quote.currency,
      totalCents: quote.totalCents,
      lines: quote.lines.map((l) => ({ sku: l.sku, quantity: l.quantity, lineCents: l.lineCents })),
      customer: {
        fullName: String(customer.fullName || '').slice(0, 120),
        email: String(customer.email || '').slice(0, 254),
      },
      createdAt: new Date().toISOString(),
    });

    return res.status(201).json({
      ok: true,
      orderId: order.id,
      referenceId,
      summary: {
        lines: quote.lines.map((l) => ({ sku: l.sku, quantity: l.quantity, unit: l.unit, line: l.line })),
        itemTotal: quote.itemTotal,
        shipping: quote.shipping,
        total: quote.total,
        currency: quote.currency,
      },
    });
  } catch (err) {
    logger.error('Failed to create PayPal order', {
      referenceId, error: err.message, status: err.status, meta: err.meta,
    });
    return res.status(err.status && err.status < 500 ? 400 : 502)
      .json({ ok: false, error: 'We could not start the checkout. Please try again.' });
  }
});

/**
 * POST /api/capture-paypal-order
 *
 * Body: { orderId: string }
 * Called from the PayPal Buttons onApprove callback — this is the step that
 * moves the money. Fulfilment side effects live in the WEBHOOK, not here:
 * the buyer can close the tab mid-request and the money still moves.
 */
router.post('/capture-paypal-order', checkoutLimiter, async (req, res) => {
  const { orderId } = req.body || {};

  if (!orderId || typeof orderId !== 'string' || orderId.length > 64) {
    return res.status(422).json({ ok: false, error: 'A valid orderId is required.' });
  }

  try {
    const result = await paypal.captureOrder(orderId);
    const capture = result?.purchase_units?.[0]?.payments?.captures?.[0];
    const shipping = result?.purchase_units?.[0]?.shipping;

    logger.info('Capture completed via client callback', {
      orderId, captureId: capture?.id, status: result?.status,
    });

    return res.json({
      ok: true,
      status: result?.status,
      captureId: capture?.id,
      /* Shown as confirmation only. Fulfilment reads the webhook. */
      shipTo: shipping?.name?.full_name || null,
    });
  } catch (err) {
    /* INSTRUMENT_DECLINED is recoverable — PayPal wants the buyer to pick a
       different funding source and the JS SDK can restart the flow. */
    const declined = err.meta?.details?.some?.((d) => d.issue === 'INSTRUMENT_DECLINED');

    logger.error('Capture failed', { orderId, error: err.message, status: err.status, meta: err.meta });

    if (declined) {
      return res.status(402).json({ ok: false, error: 'INSTRUMENT_DECLINED', recoverable: true });
    }
    return res.status(502).json({
      ok: false,
      error: 'We could not complete the payment. You have not been charged.',
    });
  }
});

module.exports = router;
