'use strict';

/**
 * Process entry point: build the app, bind the port, handle signals.
 *
 * App construction lives in src/app.js so it can be imported without
 * starting a listener.
 */

const config = require('./src/config');
const logger = require('./src/logger');
const createApp = require('./src/app');

const app = createApp();

const server = app.listen(config.port, () => {
  logger.info('Server listening', {
    port: config.port,
    env: config.env,
    paypalEnv: config.paypal.env,
  });
});

// ── Graceful shutdown ─────────────────────────────────────────────────
// Platforms send SIGTERM on deploy. Finish in-flight requests (severing a
// payment capture mid-flight is a bad outcome) then exit.
let shuttingDown = false;

function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;

  logger.info('Shutting down', { signal });

  server.close(() => {
    logger.info('Closed out remaining connections');
    process.exit(0);
  });

  setTimeout(() => {
    logger.error('Forced shutdown after 10s timeout');
    process.exit(1);
  }, 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled promise rejection', { reason: String(reason) });
});

process.on('uncaughtException', (err) => {
  // Process state is unknown after this — log and let the platform restart.
  logger.error('Uncaught exception — exiting', { error: err.message, stack: err.stack });
  process.exit(1);
});

module.exports = server;
