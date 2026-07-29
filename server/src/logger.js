'use strict';

/**
 * Minimal structured logger.
 *
 * Logs single-line JSON so hosting platforms (Railway, Render, Fly,
 * CloudWatch, Loki) can index the fields instead of regexing prose.
 *
 * Anything that could contain a secret or full PII payload goes through
 * `redact()` first — logs get shipped to third parties and retained far
 * longer than you expect.
 */

const REDACT_KEYS = new Set([
  'authorization', 'password', 'pass', 'secret', 'client_secret',
  'access_token', 'api_key', 'apikey', 'token',
  'paypal_client_secret', 'sendgrid_api_key', 'smtp_pass',
]);

function redact(value, depth = 0) {
  if (depth > 4 || value == null) return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (typeof value !== 'object') return value;

  const out = {};
  for (const [k, v] of Object.entries(value)) {
    out[k] = REDACT_KEYS.has(k.toLowerCase())
      ? '[redacted]'
      : redact(v, depth + 1);
  }
  return out;
}

function emit(level, message, meta) {
  const line = {
    ts: new Date().toISOString(),
    level,
    message,
    ...(meta ? redact(meta) : {}),
  };

  const serialised = JSON.stringify(line);
  if (level === 'error') process.stderr.write(serialised + '\n');
  else process.stdout.write(serialised + '\n');
}

module.exports = {
  debug: (m, meta) => process.env.NODE_ENV !== 'production' && emit('debug', m, meta),
  info: (m, meta) => emit('info', m, meta),
  warn: (m, meta) => emit('warn', m, meta),
  error: (m, meta) => emit('error', m, meta),
};
