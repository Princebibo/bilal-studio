'use strict';

require('dotenv').config();

/**
 * Environment loading with fail-fast validation.
 *
 * A server that boots with a missing PAYPAL_WEBHOOK_ID and only discovers
 * it three days later — when a real payment webhook silently fails
 * verification — is worse than a server that refuses to start. So we
 * validate everything up front and exit(1) with a readable list.
 */

const logger = require('./logger');

const missing = [];
const problems = [];

function req(key) {
  const v = process.env[key];
  if (!v || !String(v).trim()) { missing.push(key); return ''; }
  return String(v).trim();
}

function opt(key, fallback = '') {
  const v = process.env[key];
  return v == null || !String(v).trim() ? fallback : String(v).trim();
}

function int(key, fallback) {
  const raw = process.env[key];
  if (raw == null || !String(raw).trim()) return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) { problems.push(`${key} must be an integer (got "${raw}")`); return fallback; }
  return n;
}

function bool(key, fallback = false) {
  const v = opt(key);
  if (!v) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(v.toLowerCase());
}

const NODE_ENV = opt('NODE_ENV', 'development');
const MAIL_DRIVER = opt('MAIL_DRIVER', 'smtp').toLowerCase();
const PAYPAL_ENV = opt('PAYPAL_ENV', 'sandbox').toLowerCase();

const config = {
  env: NODE_ENV,
  isProd: NODE_ENV === 'production',
  port: int('PORT', 3000),

  corsOrigins: opt('CORS_ORIGINS')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),

  mail: {
    driver: MAIL_DRIVER,
    notifyEmail: req('NOTIFY_EMAIL'),
    fromName: opt('MAIL_FROM_NAME', 'Bilal Studio'),
    fromEmail: req('MAIL_FROM_EMAIL'),
    smtp: {
      host: MAIL_DRIVER === 'smtp' ? req('SMTP_HOST') : opt('SMTP_HOST'),
      port: int('SMTP_PORT', 587),
      secure: bool('SMTP_SECURE', false),
      user: MAIL_DRIVER === 'smtp' ? req('SMTP_USER') : opt('SMTP_USER'),
      pass: MAIL_DRIVER === 'smtp' ? req('SMTP_PASS') : opt('SMTP_PASS'),
    },
    sendgridKey: MAIL_DRIVER === 'sendgrid' ? req('SENDGRID_API_KEY') : opt('SENDGRID_API_KEY'),
  },

  paypal: {
    env: PAYPAL_ENV,
    base: PAYPAL_ENV === 'live'
      ? 'https://api-m.paypal.com'
      : 'https://api-m.sandbox.paypal.com',
    clientId: req('PAYPAL_CLIENT_ID'),
    clientSecret: req('PAYPAL_CLIENT_SECRET'),
    webhookId: req('PAYPAL_WEBHOOK_ID'),
  },

  pricing: {
    currency: opt('CURRENCY', 'USD').toUpperCase(),
    shippingCents: int('SHIPPING_FLAT_CENTS', 0),
    maxQuantity: int('MAX_QUANTITY', 100),
    tiers: {
      one: int('PRICE_TIER_1', 4500),
      twoToFour: int('PRICE_TIER_2_4', 4000),
      fiveToNine: int('PRICE_TIER_5_9', 3500),
      tenPlus: int('PRICE_TIER_10_PLUS', 3000),
    },
  },
};

// ── Cross-field sanity checks ────────────────────────────────────────
if (!['smtp', 'sendgrid'].includes(MAIL_DRIVER)) {
  problems.push(`MAIL_DRIVER must be "smtp" or "sendgrid" (got "${MAIL_DRIVER}")`);
}
if (!['sandbox', 'live'].includes(PAYPAL_ENV)) {
  problems.push(`PAYPAL_ENV must be "sandbox" or "live" (got "${PAYPAL_ENV}")`);
}
if (config.isProd && config.corsOrigins.length === 0) {
  problems.push('CORS_ORIGINS must be set in production — refusing to allow every origin');
}
if (config.isProd && config.corsOrigins.includes('*')) {
  problems.push('CORS_ORIGINS cannot be "*" in production');
}
if (config.pricing.maxQuantity < 1) {
  problems.push('MAX_QUANTITY must be at least 1');
}

if (missing.length || problems.length) {
  logger.error('Invalid configuration — server will not start', {
    missingEnvVars: missing,
    problems,
    hint: 'Copy .env.example to .env and fill in the blanks.',
  });
  process.exit(1);
}

// A live PayPal env with sandbox-looking config is worth shouting about.
if (PAYPAL_ENV === 'live' && !config.isProd) {
  logger.warn('PAYPAL_ENV=live while NODE_ENV is not production — real money is in play');
}

logger.info('Configuration loaded', {
  env: config.env,
  paypalEnv: config.paypal.env,
  mailDriver: config.mail.driver,
  corsOrigins: config.corsOrigins.length ? config.corsOrigins : '(dev: all)',
});

module.exports = config;
