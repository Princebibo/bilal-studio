'use strict';

const logger = require('./logger');

/**
 * In-memory store for pending order quotes + processed webhook IDs.
 *
 * ──────────────────────────────────────────────────────────────────────
 *  READ THIS BEFORE GOING LIVE
 *
 *  This is a Map in process memory. That means:
 *
 *   1. It is wiped on every restart, redeploy, and crash. A webhook that
 *      arrives after a deploy will not find its quote, so the amount
 *      cross-check degrades to "log a warning and continue" rather than
 *      a hard verification.
 *
 *   2. It does not work across multiple instances. If you scale to 2+
 *      dynos/containers, the instance that creates the order and the one
 *      that receives the webhook may differ, and neither shares state.
 *
 *   3. Webhook de-duplication is therefore best-effort. PayPal retries
 *      failed deliveries for up to 3 days; a restart mid-retry can
 *      produce a duplicate notification email.
 *
 *  For a single small instance sending yourself notification emails, this
 *  is an acceptable trade-off and avoids standing up a database on day one.
 *
 *  To make it production-durable, replace the three method bodies with
 *  Redis (`SET key val EX 172800`) or a `orders` table. The interface is
 *  deliberately tiny so that swap is ~20 lines and touches nothing else.
 * ──────────────────────────────────────────────────────────────────────
 */

// Keep entries slightly longer than PayPal's 3-day webhook retry window.
const TTL_MS = 4 * 24 * 60 * 60 * 1000;
const MAX_ENTRIES = 5000;   // hard ceiling so a flood cannot exhaust memory

const orders = new Map();          // referenceId -> { record, expiresAt }
const processedEvents = new Map(); // event id  -> expiresAt

function sweep() {
  const now = Date.now();
  for (const [k, v] of orders) if (v.expiresAt <= now) orders.delete(k);
  for (const [k, exp] of processedEvents) if (exp <= now) processedEvents.delete(k);
}

// Periodic sweep. unref() so this timer never holds the process open and
// blocks a clean shutdown.
const sweeper = setInterval(sweep, 60 * 60 * 1000);
if (typeof sweeper.unref === 'function') sweeper.unref();

/** Store the authoritative quote for a reference id. */
function put(referenceId, record) {
  if (orders.size >= MAX_ENTRIES) {
    sweep();
    if (orders.size >= MAX_ENTRIES) {
      // Drop the oldest rather than refuse a real customer's checkout.
      const oldest = orders.keys().next().value;
      orders.delete(oldest);
      logger.warn('orderStore at capacity — evicted oldest entry', { evicted: oldest });
    }
  }
  orders.set(referenceId, { record, expiresAt: Date.now() + TTL_MS });
}

/** @returns {object|null} the stored record, or null if unknown/expired. */
function get(referenceId) {
  const entry = orders.get(referenceId);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) { orders.delete(referenceId); return null; }
  return entry.record;
}

/**
 * Claim a webhook event id for processing.
 *
 * @returns {boolean} true if this is the first time we have seen it
 *                    (i.e. the caller should process it), false if duplicate.
 */
function claimEvent(eventId) {
  if (!eventId) return true;   // no id to dedupe on — process it
  if (processedEvents.has(eventId)) return false;
  processedEvents.set(eventId, Date.now() + TTL_MS);
  return true;
}

/** Release a claim so PayPal's retry can be processed after a failure. */
function releaseEvent(eventId) {
  if (eventId) processedEvents.delete(eventId);
}

function stats() {
  return { orders: orders.size, processedEvents: processedEvents.size };
}

module.exports = { put, get, claimEvent, releaseEvent, stats };
