'use strict';

const crypto = require('node:crypto');
const config = require('./config');
const logger = require('./logger');

/**
 * PayPal Orders v2 + Webhooks client.
 *
 * ── Why raw REST and not @paypal/checkout-server-sdk ──────────────────
 * That SDK is deprecated — PayPal archived the repository and it no
 * longer tracks API changes or receives security fixes. It was always a
 * thin wrapper over these exact HTTP calls, so calling them directly
 * costs ~150 lines and removes an unmaintained dependency from the
 * supply chain. Node 18+ ships global fetch, so there is no HTTP client
 * dependency either.
 *
 * ── Where does the money go? ──────────────────────────────────────────
 * To the account that owns PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET.
 * There is deliberately no "merchant email" field set below: in Orders
 * v2, `purchase_units[].payee` exists for third-party/marketplace payouts
 * and requires granted permissions. Setting it to your own account is
 * redundant at best and returns PAYEE_ACCOUNT_INVALID at worst. To route
 * funds to a given account, generate the REST credentials while logged in
 * as that account. Nothing in this file needs to change.
 */

const { base, clientId, clientSecret, webhookId } = config.paypal;

const TIMEOUT_MS = 10_000;

// ─────────────────────────────────────────────────────────────────────
//  Access token cache
// ─────────────────────────────────────────────────────────────────────
// Tokens last ~9 hours. Fetching one per request wastes a round trip on
// every checkout and will eventually get rate limited.
let tokenCache = { value: null, expiresAt: 0 };

/** A fetch that always times out rather than hanging a request forever. */
async function httpJson(url, options = {}, { rawText = false } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let res;
  try {
    res = await fetch(url, { ...options, signal: controller.signal });
  } catch (err) {
    clearTimeout(timer);
    if (err.name === 'AbortError') {
      throw new PayPalError(`PayPal request timed out after ${TIMEOUT_MS}ms`, 504);
    }
    throw new PayPalError(`Could not reach PayPal: ${err.message}`, 502);
  }
  clearTimeout(timer);

  const text = await res.text();
  let body = null;
  if (text) {
    try { body = JSON.parse(text); } catch { body = { raw: text }; }
  }

  if (!res.ok) {
    // PayPal returns a machine-readable error shape; surface the useful parts.
    throw new PayPalError(
      body?.message || `PayPal responded ${res.status}`,
      res.status,
      {
        debugId: res.headers.get('paypal-debug-id'),
        name: body?.name,
        details: body?.details,
      },
    );
  }

  return rawText ? text : body;
}

class PayPalError extends Error {
  constructor(message, status = 502, meta = {}) {
    super(message);
    this.name = 'PayPalError';
    this.status = status;
    this.meta = meta;
  }
}

/** OAuth2 client-credentials token, cached until shortly before expiry. */
async function getAccessToken() {
  const now = Date.now();
  if (tokenCache.value && now < tokenCache.expiresAt) return tokenCache.value;

  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const body = await httpJson(`${base}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });

  if (!body?.access_token) throw new PayPalError('PayPal returned no access token', 502);

  // Refresh 5 minutes early so an in-flight request never uses a dead token.
  const ttlMs = Math.max((Number(body.expires_in) || 3600) * 1000 - 300_000, 60_000);
  tokenCache = { value: body.access_token, expiresAt: now + ttlMs };

  logger.debug('PayPal access token refreshed', { expiresInSeconds: body.expires_in });
  return tokenCache.value;
}

async function authed(path, { method = 'GET', body, headers = {} } = {}) {
  const token = await getAccessToken();
  return httpJson(`${base}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

// ─────────────────────────────────────────────────────────────────────
//  Orders
// ─────────────────────────────────────────────────────────────────────

/**
 * Create a PayPal order from a server-derived price quote.
 *
 * @param {object}  args
 * @param {object}  args.quote      Output of pricing.quote() — the only price source.
 * @param {object}  args.customer   Optional prefill { name, email, businessName }.
 * @param {string}  args.referenceId Our own order reference, echoed back on the webhook.
 */
async function createOrder({ quote, customer = {}, referenceId }) {
  const { currency, quantity, unit, itemTotal, shipping, total } = quote;

  const payload = {
    intent: 'CAPTURE',
    purchase_units: [{
      reference_id: referenceId,
      // custom_id survives the whole lifecycle and comes back on the
      // webhook — this is how we correlate a capture to our own record.
      custom_id: referenceId,
      description: `NFC Google Review Card × ${quantity}`,
      soft_descriptor: 'REVIEWCARD',
      amount: {
        currency_code: currency,
        value: total,
        breakdown: {
          item_total: { currency_code: currency, value: itemTotal },
          shipping: { currency_code: currency, value: shipping },
        },
      },
      items: [{
        name: 'NFC Google Review Card',
        description: 'Custom-printed NFC card linked to your Google review page',
        quantity: String(quantity),
        unit_amount: { currency_code: currency, value: unit },
        category: 'PHYSICAL_GOODS',
      }],
    }],
    payment_source: {
      paypal: {
        experience_context: {
          brand_name: 'Bibo Saya Studio',
          user_action: 'PAY_NOW',
          // Physical product — we need an address to ship to.
          shipping_preference: 'GET_FROM_FILE',
          landing_page: 'NO_PREFERENCE',
        },
      },
    },
  };

  const order = await authed('/v2/checkout/orders', {
    method: 'POST',
    body: payload,
    headers: {
      // Idempotency: if the client retries on a flaky network, PayPal
      // returns the SAME order instead of creating a duplicate.
      'PayPal-Request-Id': referenceId,
      Prefer: 'return=representation',
    },
  });

  logger.info('PayPal order created', {
    orderId: order.id,
    referenceId,
    quantity,
    total,
    currency,
  });

  return order;
}

/** Capture an approved order. Called after the buyer approves in the popup. */
async function captureOrder(orderId) {
  const result = await authed(`/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, {
    method: 'POST',
    body: {},
    headers: {
      // Safe to retry: PayPal will not double-charge for the same key.
      'PayPal-Request-Id': `capture-${orderId}`,
      Prefer: 'return=representation',
    },
  });

  logger.info('PayPal order captured', { orderId, status: result.status });
  return result;
}

/**
 * Fetch full order detail.
 *
 * Needed by the webhook: a PAYMENT.CAPTURE.COMPLETED event resource is a
 * *capture* object, which does not reliably carry the payer name or the
 * shipping address. Those live on the order, so we fetch it to build a
 * useful notification email.
 */
async function getOrder(orderId) {
  return authed(`/v2/checkout/orders/${encodeURIComponent(orderId)}`);
}

// ─────────────────────────────────────────────────────────────────────
//  Webhook signature verification
// ─────────────────────────────────────────────────────────────────────

/**
 * Verify a webhook against PayPal's verification endpoint.
 *
 * CRITICAL: `rawBody` must be the exact bytes PayPal sent. The signature
 * covers the literal payload, so a JSON.parse → JSON.stringify round trip
 * can reorder keys or change whitespace and fail verification even though
 * the event is genuine. That is why the verification request body is
 * assembled as a string with the raw event spliced in verbatim, rather
 * than built with JSON.stringify.
 *
 * @param {object} headers  Express req.headers
 * @param {string} rawBody  Untouched request body as UTF-8
 * @returns {Promise<boolean>}
 */
async function verifyWebhook(headers, rawBody) {
  const transmissionId = headers['paypal-transmission-id'];
  const transmissionTime = headers['paypal-transmission-time'];
  const transmissionSig = headers['paypal-transmission-sig'];
  const certUrl = headers['paypal-cert-url'];
  const authAlgo = headers['paypal-auth-algo'];

  if (!transmissionId || !transmissionTime || !transmissionSig || !certUrl || !authAlgo) {
    logger.warn('Webhook rejected: missing PayPal signature headers', {
      present: Object.keys(headers).filter((h) => h.startsWith('paypal-')),
    });
    return false;
  }

  // Hygiene: the cert must come from PayPal, not an attacker-chosen host.
  let host;
  try { host = new URL(certUrl).hostname; } catch { return false; }
  if (!/(^|\.)paypal\.com$/i.test(host)) {
    logger.warn('Webhook rejected: cert_url is not a paypal.com host', { host });
    return false;
  }

  const q = (s) => JSON.stringify(String(s));
  const verificationBody =
    '{'
    + `"auth_algo":${q(authAlgo)},`
    + `"cert_url":${q(certUrl)},`
    + `"transmission_id":${q(transmissionId)},`
    + `"transmission_sig":${q(transmissionSig)},`
    + `"transmission_time":${q(transmissionTime)},`
    + `"webhook_id":${q(webhookId)},`
    + `"webhook_event":${rawBody}`   // ← verbatim, never re-serialised
    + '}';

  const token = await getAccessToken();
  const result = await httpJson(`${base}/v1/notifications/verify-webhook-signature`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: verificationBody,
  });

  const ok = result?.verification_status === 'SUCCESS';
  if (!ok) {
    logger.warn('Webhook signature verification failed', {
      status: result?.verification_status,
      transmissionId,
    });
  }
  return ok;
}

/** Order reference: sortable, collision-resistant, safe in a URL/header. */
function newReferenceId(prefix = 'NFC') {
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  return `${prefix}-${stamp}-${crypto.randomBytes(5).toString('hex').toUpperCase()}`;
}

module.exports = {
  createOrder,
  captureOrder,
  getOrder,
  verifyWebhook,
  newReferenceId,
  PayPalError,
};
