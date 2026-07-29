'use strict';

const express = require('express');
const rateLimit = require('express-rate-limit');

const config = require('../config');
const logger = require('../logger');
const mailer = require('../mailer');
const templates = require('../templates');
const { validateLead, isSpam } = require('../validate');

const router = express.Router();

/**
 * Lead form submissions are the most abused endpoint on any marketing
 * site. 5 per 15 minutes per IP is generous for a human filling in one
 * form and hostile to a script.
 */
const leadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { ok: false, error: 'Too many submissions. Please try again in a few minutes.' },
});

/**
 * POST /api/lead
 *
 * Body: { fullName, email, phone, businessName, service, notes, _company_url }
 *
 * Sends two emails: a notification to NOTIFY_EMAIL and a confirmation to
 * the customer. Both are best-effort — see the note on partial failure below.
 */
router.post('/lead', leadLimiter, async (req, res) => {
  const ip = req.ip;

  // ── Honeypot ───────────────────────────────────────────────────────
  // Respond 200 so the bot believes it succeeded and does not retry with
  // a different strategy. Nothing is sent.
  if (isSpam(req.body)) {
    logger.warn('Lead rejected: honeypot triggered', { ip });
    return res.status(200).json({ ok: true, message: 'Thanks — we will be in touch.' });
  }

  // ── Validation ─────────────────────────────────────────────────────
  const result = validateLead(req.body);
  if (!result.ok) {
    logger.info('Lead rejected: validation failed', { ip, fields: Object.keys(result.errors) });
    return res.status(422).json({
      ok: false,
      error: 'Please check the highlighted fields.',
      fields: result.errors,
    });
  }

  const lead = result.data;
  const receivedAt = new Date().toUTCString();

  logger.info('Lead received', {
    email: lead.email,
    businessName: lead.businessName,
    service: lead.service,
    ip,
  });

  // ── Dispatch both emails concurrently ──────────────────────────────
  const notification = templates.leadNotification(lead, { receivedAt, ip });
  const confirmation = templates.leadConfirmation(lead);

  const [ownerResult, customerResult] = await Promise.all([
    mailer.send({
      to: config.mail.notifyEmail,
      subject: notification.subject,
      html: notification.html,
      // Reply goes straight to the lead, not to your own From address.
      replyTo: lead.email,
    }),
    mailer.send({
      to: lead.email,
      subject: confirmation.subject,
      html: confirmation.html,
      replyTo: config.mail.notifyEmail,
    }),
  ]);

  /**
   * Partial-failure policy.
   *
   * The lead is only "captured" if the OWNER notification landed — that
   * email is the system of record here (there is no database). If it
   * failed, tell the user honestly so they can call instead, rather than
   * showing a success message for an enquiry that reached nobody.
   *
   * A failed CUSTOMER confirmation is cosmetic: log it, but still report
   * success, because the enquiry did arrive.
   */
  if (!ownerResult.ok) {
    logger.error('Lead notification failed — enquiry may be lost', {
      email: lead.email,
      error: ownerResult.error,
    });
    return res.status(502).json({
      ok: false,
      error: 'We could not deliver your enquiry. Please email us directly or try again shortly.',
    });
  }

  if (!customerResult.ok) {
    logger.warn('Customer confirmation failed (lead itself was delivered)', {
      email: lead.email,
      error: customerResult.error,
    });
  }

  return res.status(200).json({
    ok: true,
    message: 'Thanks — your enquiry is in. We will reply within 24 hours.',
    confirmationSent: customerResult.ok,
  });
});

module.exports = router;
