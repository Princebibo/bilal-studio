'use strict';

const config = require('./config');
const logger = require('./logger');

/**
 * Email dispatch with two interchangeable drivers.
 *
 *   MAIL_DRIVER=smtp      → Nodemailer (Gmail, Zoho, Mailgun SMTP, …)
 *   MAIL_DRIVER=sendgrid  → SendGrid HTTP API
 *
 * ── A deliverability warning worth reading ────────────────────────────
 * Gmail SMTP is fine for notifying YOURSELF. It is a poor choice for the
 * customer-facing confirmation: Gmail caps you around 500 recipients/day,
 * you cannot set up DKIM/SPF for a domain you do not control, and mail
 * that claims to be from your business but is signed by gmail.com tends
 * to land in Promotions or Spam. For anything customer-facing, use a
 * transactional provider (SendGrid, Resend, Postmark) on your own domain
 * with SPF + DKIM + DMARC configured. The driver switch below exists so
 * that migration is a one-line env change.
 */

let transporter = null;   // nodemailer
let sendgrid = null;      // @sendgrid/mail

function initialise() {
  if (config.mail.driver === 'sendgrid') {
    try {
      sendgrid = require('@sendgrid/mail');
    } catch {
      logger.error('MAIL_DRIVER=sendgrid but @sendgrid/mail is not installed', {
        fix: 'npm install @sendgrid/mail',
      });
      process.exit(1);
    }
    sendgrid.setApiKey(config.mail.sendgridKey);
    logger.info('Mailer ready', { driver: 'sendgrid' });
    return;
  }

  const nodemailer = require('nodemailer');
  transporter = nodemailer.createTransport({
    host: config.mail.smtp.host,
    port: config.mail.smtp.port,
    secure: config.mail.smtp.secure,   // true for 465, false for 587 (STARTTLS)
    auth: {
      user: config.mail.smtp.user,
      pass: config.mail.smtp.pass,
    },
    pool: true,           // reuse connections instead of a TCP+TLS handshake per mail
    maxConnections: 3,
    maxMessages: 50,
  });

  // Verify credentials at boot rather than discovering them broken on the
  // first real lead. Non-fatal: transient DNS/network hiccups at deploy
  // time should not crash-loop the process.
  transporter.verify()
    .then(() => logger.info('Mailer ready', { driver: 'smtp', host: config.mail.smtp.host }))
    .catch((err) => logger.error('SMTP verification failed — email will not send', {
      error: err.message,
      hint: 'Gmail needs a 16-character App Password, not your account password.',
    }));
}

initialise();

/**
 * Send one email. Never throws — returns a result object instead.
 *
 * Rationale: a failed *notification* must not turn a successful lead
 * capture or a captured payment into a 500 for the user. The money is
 * already taken; the customer should not see an error because our SMTP
 * provider had a bad minute. Failures are logged loudly for follow-up.
 *
 * @returns {Promise<{ok: boolean, id?: string, error?: string}>}
 */
async function send({ to, subject, html, text, replyTo }) {
  const from = `"${config.mail.fromName}" <${config.mail.fromEmail}>`;

  try {
    if (config.mail.driver === 'sendgrid') {
      const [res] = await sendgrid.send({
        to,
        from: { email: config.mail.fromEmail, name: config.mail.fromName },
        subject,
        html,
        text: text || stripHtml(html),
        ...(replyTo ? { replyTo } : {}),
      });
      const id = res?.headers?.['x-message-id'];
      logger.info('Email sent', { driver: 'sendgrid', to, subject, id });
      return { ok: true, id };
    }

    const info = await transporter.sendMail({
      from,
      to,
      subject,
      html,
      text: text || stripHtml(html),
      ...(replyTo ? { replyTo } : {}),
    });
    logger.info('Email sent', { driver: 'smtp', to, subject, id: info.messageId });
    return { ok: true, id: info.messageId };
  } catch (err) {
    logger.error('Email send failed', {
      to, subject, driver: config.mail.driver, error: err.message,
    });
    return { ok: false, error: err.message };
  }
}

/** Crude HTML → text fallback for clients that refuse HTML. */
function stripHtml(html = '') {
  return String(html)
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|tr|h1|h2|h3|div|li)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

module.exports = { send };
