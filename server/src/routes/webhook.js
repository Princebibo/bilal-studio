'use strict';

const express = require('express');

const config = require('../config');
const logger = require('../logger');
const mailer = require('../mailer');
const paypal = require('../paypal');
const pricing = require('../pricing');
const templates = require('../templates');
const orderStore = require('../orderStore');

const router = express.Router();

/**
 * POST /api/paypal-webhook
 *
 * ── Why fulfilment lives here and not in the capture route ─────────────
 * The client-side `onApprove` → capture call can be interrupted: the buyer
 * closes the tab, their wifi drops, the browser is killed mid-request. The
 * money still moves, but our success handler never runs. The webhook is
 * server-to-server, retried by PayPal for ~3 days, and is therefore the
 * only trustworthy fulfilment trigger.
 *
 * ── Why express.raw() and not express.json() ────────────────────────────
 * Signature verification hashes the exact bytes PayPal sent. Parsing to an
 * object and re-serialising can reorder keys or alter whitespace, which
 * makes verification fail on 100% of genuine events. This route therefore
 * takes the body as a Buffer and the JSON parse happens only AFTER the
 * signature has been checked. See server.js for the mount order.
 */
router.post(
  '/paypal-webhook',
  express.raw({ type: '*/*', limit: '1mb' }),
  async (req, res) => {
    /**
     * express.raw() only sets req.body to a Buffer when a body was actually
     * sent; otherwise it leaves the Express default of {}. Coercing that
     * with String() yields "[object Object]" — truthy — which would sail
     * past an emptiness check and get sent to PayPal for verification. So
     * require a Buffer explicitly.
     */
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      logger.warn('Webhook rejected: empty or non-raw body', {
        bodyType: Buffer.isBuffer(req.body) ? 'empty buffer' : typeof req.body,
      });
      return res.status(400).send('empty body');
    }

    const rawBody = req.body.toString('utf8');

    // ── 1. Verify the signature BEFORE trusting or parsing anything ────
    let verified = false;
    try {
      verified = await paypal.verifyWebhook(req.headers, rawBody);
    } catch (err) {
      /**
       * Verification itself errored (PayPal unreachable, token expired).
       * Return 500 so PayPal RETRIES — do not swallow a possibly-real
       * payment event just because our verification call had a bad moment.
       */
      logger.error('Webhook verification threw — asking PayPal to retry', { error: err.message });
      return res.status(500).send('verification error');
    }

    if (!verified) {
      // Genuinely invalid signature. 401 and do NOT ask for a retry.
      logger.warn('Webhook rejected: invalid signature', { ip: req.ip });
      return res.status(401).send('invalid signature');
    }

    // ── 2. Parse now that the bytes are trusted ───────────────────────
    let event;
    try {
      event = JSON.parse(rawBody);
    } catch {
      logger.warn('Webhook rejected: verified but unparseable JSON');
      return res.status(400).send('bad json');
    }

    const eventId = event.id;
    const eventType = event.event_type;

    logger.info('Webhook received', { eventId, eventType });

    /**
     * ── 3. Which events we act on ─────────────────────────────────────
     *
     * INVOICING.INVOICE.PAID   the primary path now — you agree the price
     *                          over email, send a PayPal invoice, and this
     *                          fires when the customer pays it.
     *
     * PAYMENT.CAPTURE.COMPLETED still handled, because it covers any other
     *                          way money arrives: a PayPal.me link, a
     *                          manual request, or a future "pay now" button.
     *
     * Anything else gets a 200 so PayPal stops retrying it.
     */
    const HANDLED = {
      'INVOICING.INVOICE.PAID': handleInvoicePaid,
      'PAYMENT.CAPTURE.COMPLETED': handleCaptureCompleted,
    };

    const handler = HANDLED[eventType];
    if (!handler) {
      return res.status(200).json({ received: true, handled: false });
    }

    // ── 4. Idempotency: PayPal retries, and duplicates happen ─────────
    if (!orderStore.claimEvent(eventId)) {
      logger.info('Webhook ignored: already processed', { eventId });
      return res.status(200).json({ received: true, duplicate: true });
    }

    try {
      await handler(event);
      return res.status(200).json({ received: true, handled: true });
    } catch (err) {
      /**
       * Release the idempotency claim so PayPal's retry is allowed to run.
       * Without this, a transient failure here would permanently mark the
       * event as processed and the order would never be fulfilled.
       */
      orderStore.releaseEvent(eventId);
      logger.error('Webhook handler failed — released claim for retry', {
        eventId, error: err.message,
      });
      return res.status(500).send('handler error');
    }
  },
);

/**
 * INVOICING.INVOICE.PAID — the primary payment path.
 *
 * The invoice resource carries billing name, email, business name and the
 * shipping address inline, so unlike a capture event there is no follow-up
 * API call needed to build a useful notification.
 *
 * There is deliberately no amount cross-check here: you set the amount
 * yourself when creating the invoice in PayPal, so there is no
 * client-supplied figure that could have been tampered with.
 */
async function handleInvoicePaid(event) {
  const invoice = event.resource || {};

  const mail = templates.invoicePaidNotification(invoice);
  const customerEmail = invoice?.primary_recipients?.[0]?.billing_info?.email_address;

  const result = await mailer.send({
    to: config.mail.notifyEmail,
    subject: mail.subject,
    html: mail.html,
    ...(customerEmail ? { replyTo: customerEmail } : {}),
  });

  // Throw so the caller releases the idempotency claim and PayPal retries.
  if (!result.ok) {
    throw new Error(`invoice notification email failed: ${result.error}`);
  }

  logger.info('Invoice paid notification sent', {
    invoiceNumber: invoice?.detail?.invoice_number,
    amount: invoice?.amount?.value,
    currency: invoice?.amount?.currency_code,
  });
}

/**
 * PAYMENT.CAPTURE.COMPLETED — any other way money arrives.
 *
 * The capture resource does NOT reliably include the payer name or the
 * shipping address, so we fetch the parent order to get them.
 */
async function handleCaptureCompleted(event) {
  const capture = event.resource || {};
  const captureId = capture.id;
  const referenceId = capture.custom_id || null;
  const orderId = capture.supplementary_data?.related_ids?.order_id;

  let payer = null;
  let shipping = null;
  let quantity = null;

  // Fetch the order for payer + shipping. Non-fatal: if this fails we still
  // want the "you got paid" email out, just with less detail.
  if (orderId) {
    try {
      const order = await paypal.getOrder(orderId);
      payer = order?.payer || null;
      const unit = order?.purchase_units?.[0];
      shipping = unit?.shipping || null;
      const qty = unit?.items?.[0]?.quantity;
      if (qty) quantity = Number.parseInt(qty, 10);
    } catch (err) {
      logger.warn('Could not fetch order detail for webhook', {
        orderId, error: err.message,
      });
    }
  }

  // ── Cross-check the captured amount against our own quote ───────────
  const stored = referenceId ? orderStore.get(referenceId) : null;
  if (stored) {
    if (quantity == null) quantity = stored.quantity;

    const matches = pricing.capturedAmountMatches(
      { currency: stored.currency, totalCents: stored.totalCents },
      capture.amount?.value,
      capture.amount?.currency_code,
    );

    if (!matches) {
      // Loud, because the only innocent explanations are a partial capture
      // or a pricing change mid-flight. The others are not innocent.
      logger.error('AMOUNT MISMATCH on captured payment — review manually', {
        referenceId,
        captureId,
        expected: `${(stored.totalCents / 100).toFixed(2)} ${stored.currency}`,
        captured: `${capture.amount?.value} ${capture.amount?.currency_code}`,
      });
    }
  } else if (referenceId) {
    // Expected after a redeploy — the in-memory quote is gone. See orderStore.
    logger.warn('No stored quote for reference — amount not cross-checked', { referenceId });
  }

  const mail = templates.paymentNotification({
    capture,
    payer,
    shipping,
    quantity,
    referenceId: referenceId || captureId || 'unknown',
  });

  const result = await mailer.send({
    to: config.mail.notifyEmail,
    subject: mail.subject,
    html: mail.html,
    ...(payer?.email_address ? { replyTo: payer.email_address } : {}),
  });

  // Throw so the caller releases the idempotency claim and PayPal retries.
  if (!result.ok) {
    throw new Error(`payment notification email failed: ${result.error}`);
  }

  logger.info('Payment notification sent', {
    referenceId, captureId, quantity,
    amount: capture.amount?.value,
  });
}

module.exports = router;
