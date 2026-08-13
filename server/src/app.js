'use strict';

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');

const config = require('./config');   // validates env, exits on failure
const logger = require('./logger');
const orderStore = require('./orderStore');

const leadRoutes = require('./routes/lead');
const webhookRoutes = require('./routes/webhook');

/**
 * NOTE — the checkout routes are intentionally NOT mounted.
 *
 * Both storefronts take orders by email and invoice afterwards, so nothing
 * calls /api/create-paypal-order. src/routes/checkout.js and src/pricing.js
 * stay on disk, working and tested, for the day an on-site "pay now" is
 * wanted. To re-enable:
 *
 *   const checkoutRoutes = require('./routes/checkout');
 *   app.use('/api', checkoutRoutes);        // after express.json()
 *
 * Unmounted means unreachable: no payment surface to secure while it is
 * not being used.
 */

/**
 * Builds the Express app WITHOUT binding a port.
 *
 * Kept separate from server.js so tests (and any future serverless adapter)
 * can import the app and drive it with an ephemeral port. A module that
 * calls listen() as an import side effect cannot be tested.
 */
function createApp() {
  const app = express();

  /**
   * Trust the reverse proxy in production.
   *
   * Without this, req.ip is the load balancer's address for every request,
   * which makes per-IP rate limiting useless — everyone shares one bucket.
   * Set to 1 (not `true`) so only the nearest proxy is trusted; blanket
   * trust lets a client forge X-Forwarded-For and bypass the limiter.
   */
  if (config.isProd) app.set('trust proxy', 1);

  app.disable('x-powered-by');

  // ── Security headers ────────────────────────────────────────────────
  // This is a JSON API, not an HTML host, so CSP is unnecessary here — the
  // landing page sets its own. crossOriginResourcePolicy is relaxed so the
  // browser will read cross-origin JSON responses.
  app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  }));

  // ── CORS ────────────────────────────────────────────────────────────
  app.use(cors({
    origin(origin, callback) {
      // No Origin header: curl, server-to-server, PayPal webhooks. Allow.
      if (!origin) return callback(null, true);

      // Dev convenience only. config.js refuses to boot in production with
      // an empty allowlist, so this branch cannot leak into prod.
      if (!config.isProd && config.corsOrigins.length === 0) return callback(null, true);

      if (config.corsOrigins.includes(origin)) return callback(null, true);

      logger.warn('CORS blocked', { origin });
      return callback(new Error('Origin not allowed by CORS'));
    },
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type'],
    maxAge: 86400,
  }));

  /**
   * ────────────────────────────────────────────────────────────────────
   *  MOUNT ORDER IS LOAD-BEARING
   *
   *  The webhook router installs its own express.raw() body parser and
   *  MUST be mounted before express.json(). If the JSON parser runs first
   *  it consumes the stream and the raw bytes are gone, so PayPal
   *  signature verification fails on every genuine event.
   *
   *  Do not move this line below the express.json() call.
   * ────────────────────────────────────────────────────────────────────
   */
  app.use('/api', webhookRoutes);

  // ── JSON body parsing for everything else ───────────────────────────
  // express.json() *is* body-parser — bundled into Express since 4.16, so
  // a separate body-parser dependency is redundant.
  app.use(express.json({ limit: '64kb' }));
  app.use(express.urlencoded({ extended: false, limit: '64kb' }));

  // Reject malformed JSON with a clean 400 instead of an HTML error page.
  app.use((err, req, res, next) => {
    if (err?.type === 'entity.parse.failed') {
      return res.status(400).json({ ok: false, error: 'Malformed JSON body.' });
    }
    if (err?.type === 'entity.too.large') {
      return res.status(413).json({ ok: false, error: 'Request body too large.' });
    }
    return next(err);
  });

  // ── Request logging ─────────────────────────────────────────────────
  app.use((req, res, next) => {
    const started = process.hrtime.bigint();
    res.on('finish', () => {
      const ms = Number(process.hrtime.bigint() - started) / 1e6;
      logger.info('request', {
        method: req.method,
        path: req.originalUrl,
        status: res.statusCode,
        durationMs: Math.round(ms),
        ip: req.ip,
      });
    });
    next();
  });

  // ── Routes ──────────────────────────────────────────────────────────
  app.get('/health', (req, res) => {
    res.json({
      ok: true,
      env: config.env,
      paypalEnv: config.paypal.env,
      uptimeSeconds: Math.round(process.uptime()),
      store: orderStore.stats(),
    });
  });

  app.use('/api', leadRoutes);

  // ── 404 ─────────────────────────────────────────────────────────────
  app.use((req, res) => {
    res.status(404).json({ ok: false, error: 'Not found' });
  });

  // ── Error handler ───────────────────────────────────────────────────
  // Must take four arguments for Express to treat it as error middleware.
  app.use((err, req, res, _next) => {
    const isCors = /CORS/i.test(err?.message || '');

    logger.error('Unhandled error', {
      path: req.originalUrl,
      error: err?.message,
      // Stack in dev only — production logs get shipped to third parties.
      stack: config.isProd ? undefined : err?.stack,
    });

    res.status(isCors ? 403 : 500).json({
      ok: false,
      error: isCors ? 'Origin not allowed.' : 'Something went wrong on our end.',
    });
  });

  return app;
}

module.exports = createApp;
