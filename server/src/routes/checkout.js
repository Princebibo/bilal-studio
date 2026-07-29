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
  limit: 20,                       // higher than leads: retries are normal in checkout
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { ok: false, error: 'Too many checkout attempts. Please wait a moment.' },
});

/**
 * GET /api/pricing
 *
 * Lets the frontend display accurate prices without hardcoding them in two
 * places. Note this is a READ of the same tier table the server charges
 * from — it is not an input to pricing. The client still only ever sends
 * a quantity.
 */
router.get('/pricing', (req, res) => {
  const tiers = [1, 2, 5, 10].map((q) => {
    const quote = pricing.quote(q);
    return { minQuantity: q, unitPrice: quote.unit, currency: quote.currency };
  });
  res.json({ ok: true, tiers });
});

/**
 * POST /api/create-paypal-order
 *
 * Body: { quantity: number, customer?: { fullName, email, businessName } }
 *
 * Returns: { ok: true, orderId, referenceId, summary }
 *
 * ── The amount is NOT accepted from the client ─────────────────────────
 * Only `quantity` is read. The price comes from pricing.quote(). If the
 * request body contains an `amount` or `total`, it is ignored entirely —
 * and logged, because a client sending one is either a stale frontend or
 * someone probing for exactly this vulnerability.
 */
router.post('/create-paypal-order', checkoutLimiter, async (req, res) => {
  const { quantity: rawQuantity, customer = {} } = req.body || {};

  if (req.body && (req.body.amount != null || req.body.total != null || req.body.price != null)) {
    logger.warn('Client sent a price field to create-paypal-order — ignored', {
      ip: req.ip,
      sent: { amount: req.body.amount, total: req.body.total, price: req.body.price },
    });
  }

  const parsed = pricing.parseQuantity(rawQuantity);
  if (!parsed.ok) {
    return res.status(422).json({ ok: false, error: parsed.error });
  }

  const quote = pricing.quote(parsed.quantity);
  const referenceId = paypal.newReferenceId();

  try {
    const order = await paypal.createOrder({ quote, customer, referenceId });

    /**
     * Persist the quote against our reference BEFORE returning.
     *
     * The webhook arrives later, out of band, and needs to know what this
     * order was supposed to cost in order to detect a mismatch. Without
     * this record the amount check in the webhook has nothing to compare
     * against.
     */
    orderStore.put(referenceId, {
      referenceId,
      paypalOrderId: order.id,
      quantity: quote.quantity,
      totalCents: quote.totalCents,
      currency: quote.currency,
      customer: {
        fullName: String(customer.fullName || '').slice(0, 120),
        email: String(customer.email || '').slice(0, 254),
        businessName: String(customer.businessName || '').slice(0, 160),
      },
      createdAt: new Date().toISOString(),
    });

    return res.status(201).json({
      ok: true,
      orderId: order.id,
      referenceId,
      summary: {
        quantity: quote.quantity,
        unitPrice: quote.unit,
        shipping: quote.shipping,
        total: quote.total,
        currency: quote.currency,
      },
    });
  } catch (err) {
    logger.error('Failed to create PayPal order', {
      referenceId,
      quantity: parsed.quantity,
      error: err.message,
      status: err.status,
      meta: err.meta,
    });
    return res.status(err.status && err.status < 500 ? 400 : 502).json({
      ok: false,
      error: 'We could not start the checkout. Please try again.',
    });
  }
});

/**
 * POST /api/capture-paypal-order
 *
 * Body: { orderId: string }
 *
 * Called from the PayPal Buttons `onApprove` callback. This is the step
 * that actually moves the money; PAYMENT.CAPTURE.COMPLETED (and therefore
 * the webhook) only fires after a successful capture.
 *
 * Fulfilment side effects live in the WEBHOOK, not here — see the note in
 * routes/webhook.js for why.
 */
router.post('/capture-paypal-order', checkoutLimiter, async (req, res) => {
  const { orderId } = req.body || {};

  if (!orderId || typeof orderId !== 'string' || orderId.length > 64) {
    return res.status(422).json({ ok: false, error: 'A valid orderId is required.' });
  }

  try {
    const result = await paypal.captureOrder(orderId);
    const capture = result?.purchase_units?.[0]?.payments?.captures?.[0];

    logger.info('Capture completed via client callback', {
      orderId,
      captureId: capture?.id,
      status: result?.status,
    });

    return res.json({
      ok: true,
      status: result?.status,
      captureId: capture?.id,
      // The frontend shows this; do not trust it for fulfilment.
      amount: capture?.amount,
    });
  } catch (err) {
    /**
     * INSTRUMENT_DECLINED is recoverable: PayPal wants the buyer to pick a
     * different funding source and the JS SDK can restart the flow if we
     * tell it to.
     */
    const declined = err.meta?.details?.some?.(
      (d) => d.issue === 'INSTRUMENT_DECLINED',
    );

    logger.error('Capture failed', {
      orderId, error: err.message, status: err.status, meta: err.meta,
    });

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
