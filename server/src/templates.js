'use strict';

/**
 * HTML email templates.
 *
 * ── Escaping is a security control here, not cosmetics ────────────────
 * Every value below originates from an untrusted form field. Interpolating
 * it raw would let someone submit a business name of
 *   <a href="https://evil.example">Click to verify your PayPal</a>
 * and have YOUR mail client render a working phishing link inside a mail
 * you trust. Every interpolation goes through esc().
 *
 * ── Why tables and inline styles ──────────────────────────────────────
 * Outlook renders with Microsoft Word's HTML engine: no flexbox, no grid,
 * unreliable <style> blocks. Tables + inline styles is the format that
 * survives. Palette matches the landing page (warm neutrals + sienna).
 */

const C = {
  ink: '#14110F',
  inkSoft: '#4A4441',
  inkFaint: '#6E6864',
  paper: '#FAF8F5',
  paperAlt: '#F2EEE8',
  rule: '#E2DCD3',
  accent: '#B4522B',
};

/**
 * Sanitise a value for use in a Subject: header.
 *
 * Subjects are not HTML-rendered, so this is not an XSS control — control
 * characters (the header-injection vector) are already stripped in
 * validate.js. This exists so that a business name containing markup does
 * not produce an unreadable subject line in your inbox.
 */
function subjectSafe(value, max = 90) {
  return String(value ?? '')
    .replace(/<[^>]*>/g, '')     // drop tag-looking spans
    .replace(/[<>]/g, '')        // and any stray brackets
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

/** Escape the five characters that matter in an HTML context. */
function esc(value) {
  if (value == null) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Outer shell shared by every template. */
function shell({ preheader, heading, eyebrow, bodyHtml, footerHtml = '' }) {
  return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(heading)}</title>
</head>
<body style="margin:0;padding:0;background:${C.paperAlt};">
  <!-- Preheader: the grey preview text next to the subject line. -->
  <div style="display:none;font-size:1px;color:${C.paperAlt};line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">${esc(preheader)}</div>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.paperAlt};padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;background:${C.paper};border:1px solid ${C.rule};border-radius:4px;">

        <tr><td style="padding:32px 32px 0 32px;">
          <p style="margin:0;font:500 11px/1.4 -apple-system,'Segoe UI',Arial,sans-serif;letter-spacing:.14em;text-transform:uppercase;color:${C.inkFaint};">${esc(eyebrow)}</p>
          <h1 style="margin:14px 0 0 0;font:600 26px/1.2 Georgia,'Times New Roman',serif;letter-spacing:-.02em;color:${C.ink};">${esc(heading)}</h1>
        </td></tr>

        <tr><td style="padding:24px 32px 32px 32px;font:400 15px/1.65 -apple-system,'Segoe UI',Arial,sans-serif;color:${C.inkSoft};">
          ${bodyHtml}
        </td></tr>

      </table>

      ${footerHtml ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;">
        <tr><td style="padding:20px 32px;font:400 12px/1.6 -apple-system,'Segoe UI',Arial,sans-serif;color:${C.inkFaint};text-align:center;">${footerHtml}</td></tr>
      </table>` : ''}

    </td></tr>
  </table>
</body></html>`;
}

/** Definition-list style rows. Values are escaped; labels are ours. */
function rows(pairs) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-top:1px solid ${C.rule};margin:0 0 8px 0;">
    ${pairs
      .filter(([, v]) => v != null && String(v).trim() !== '')
      .map(([label, value]) => `<tr>
        <td style="padding:11px 12px 11px 0;border-bottom:1px solid ${C.rule};font:500 11px/1.5 -apple-system,'Segoe UI',Arial,sans-serif;letter-spacing:.1em;text-transform:uppercase;color:${C.inkFaint};white-space:nowrap;vertical-align:top;">${esc(label)}</td>
        <td style="padding:11px 0;border-bottom:1px solid ${C.rule};font:400 15px/1.55 -apple-system,'Segoe UI',Arial,sans-serif;color:${C.ink};text-align:right;">${esc(value)}</td>
      </tr>`).join('')}
  </table>`;
}

function button(href, label) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0 0 0;">
    <tr><td style="background:${C.accent};border-radius:3px;">
      <a href="${esc(href)}" style="display:inline-block;padding:13px 26px;font:500 15px/1 -apple-system,'Segoe UI',Arial,sans-serif;color:${C.paper};text-decoration:none;">${esc(label)}</a>
    </td></tr>
  </table>`;
}

// ─────────────────────────────────────────────────────────────────────
//  1. New lead → your inbox
// ─────────────────────────────────────────────────────────────────────
function leadNotification(lead, meta = {}) {
  const bodyHtml = `
    <p style="margin:0 0 20px 0;">A new enquiry just came in through the website.</p>
    ${rows([
      ['Name', lead.fullName],
      ['Business', lead.businessName],
      ['Email', lead.email],
      ['Phone', lead.phone],
      ['Service', lead.service],
    ])}
    ${lead.notes ? `
      <p style="margin:24px 0 8px 0;font:500 11px/1.5 -apple-system,'Segoe UI',Arial,sans-serif;letter-spacing:.1em;text-transform:uppercase;color:${C.inkFaint};">Notes</p>
      <div style="padding:16px;background:${C.paperAlt};border-left:2px solid ${C.accent};font:400 15px/1.6 -apple-system,'Segoe UI',Arial,sans-serif;color:${C.ink};white-space:pre-wrap;">${esc(lead.notes)}</div>
    ` : ''}
    ${button(`mailto:${encodeURIComponent(lead.email)}?subject=${encodeURIComponent('Re: your enquiry')}`, `Reply to ${lead.fullName.split(' ')[0]}`)}
    <p style="margin:24px 0 0 0;font:400 12px/1.6 -apple-system,'Segoe UI',Arial,sans-serif;color:${C.inkFaint};">
      Received ${esc(meta.receivedAt || new Date().toUTCString())}${meta.ip ? ` &middot; IP ${esc(meta.ip)}` : ''}
    </p>`;

  const who = subjectSafe(lead.fullName, 60);
  const biz = subjectSafe(lead.businessName, 60);

  return {
    subject: `New lead — ${who}${biz ? ` (${biz})` : ''}`,
    html: shell({
      preheader: `${lead.service} · ${lead.email}`,
      eyebrow: 'New enquiry',
      heading: 'You have a new lead',
      bodyHtml,
    }),
  };
}

// ─────────────────────────────────────────────────────────────────────
//  2. Confirmation → the customer
// ─────────────────────────────────────────────────────────────────────
function leadConfirmation(lead, { replyWindow = '24 hours' } = {}) {
  const firstName = String(lead.fullName || '').trim().split(/\s+/)[0] || 'there';

  const bodyHtml = `
    <p style="margin:0 0 16px 0;">Hi ${esc(firstName)},</p>
    <p style="margin:0 0 16px 0;">Thanks for getting in touch — your enquiry has landed and I have it in front of me. You will hear back within <strong style="color:${C.ink};">${esc(replyWindow)}</strong>, from me directly rather than an autoresponder.</p>
    <p style="margin:0 0 20px 0;">Here is what you sent, so you have a copy:</p>
    ${rows([
      ['Service', lead.service],
      ['Business', lead.businessName],
      ['Phone', lead.phone],
    ])}
    <p style="margin:24px 0 0 0;">If anything has changed, or you want to add detail, just reply to this email — it comes straight to me.</p>
    <p style="margin:20px 0 0 0;">Talk soon,<br><strong style="color:${C.ink};">Bilal Studio</strong></p>`;

  return {
    subject: 'We received your enquiry — Bilal Studio',
    html: shell({
      preheader: `Thanks ${firstName} — we'll reply within ${replyWindow}.`,
      eyebrow: 'Enquiry received',
      heading: 'Thanks — we have your details',
      bodyHtml,
      footerHtml: `Bilal Studio &middot; NFC Google Review Cards &amp; Web Design<br>You are receiving this because you submitted a form on our website.`,
    }),
  };
}

// ─────────────────────────────────────────────────────────────────────
//  3. Payment captured → your inbox
// ─────────────────────────────────────────────────────────────────────
function paymentNotification({ capture, payer, shipping, quantity, referenceId }) {
  const addr = shipping?.address || {};
  const addressLines = [
    shipping?.name?.full_name,
    addr.address_line_1,
    addr.address_line_2,
    [addr.admin_area_2, addr.admin_area_1, addr.postal_code].filter(Boolean).join(', '),
    addr.country_code,
  ].filter(Boolean);

  const gross = capture?.seller_receivable_breakdown?.gross_amount;
  const fee = capture?.seller_receivable_breakdown?.paypal_fee;
  const net = capture?.seller_receivable_breakdown?.net_amount;

  const money = (m) => (m ? `${m.value} ${m.currency_code}` : '');

  const bodyHtml = `
    <p style="margin:0 0 20px 0;">A card order has been paid for. Time to print and ship.</p>
    ${rows([
      ['Order ref', referenceId],
      ['Quantity', quantity ? `${quantity} card${quantity === 1 ? '' : 's'}` : ''],
      ['Gross', money(gross)],
      ['PayPal fee', fee ? `-${money(fee)}` : ''],
      ['Net to you', money(net)],
      ['Capture ID', capture?.id],
    ])}

    <p style="margin:26px 0 8px 0;font:500 11px/1.5 -apple-system,'Segoe UI',Arial,sans-serif;letter-spacing:.1em;text-transform:uppercase;color:${C.inkFaint};">Customer</p>
    ${rows([
      ['Name', [payer?.name?.given_name, payer?.name?.surname].filter(Boolean).join(' ')],
      ['Email', payer?.email_address],
      ['PayPal ID', payer?.payer_id],
    ])}

    <p style="margin:26px 0 8px 0;font:500 11px/1.5 -apple-system,'Segoe UI',Arial,sans-serif;letter-spacing:.1em;text-transform:uppercase;color:${C.inkFaint};">Ship to</p>
    <div style="padding:16px;background:${C.paperAlt};border-left:2px solid ${C.accent};font:400 15px/1.65 -apple-system,'Segoe UI',Arial,sans-serif;color:${C.ink};">
      ${addressLines.length ? addressLines.map(esc).join('<br>') : '<em style="color:' + C.inkFaint + '">No shipping address on the order — contact the customer.</em>'}
    </div>`;

  return {
    subject: `Payment received — ${money(gross)}${quantity ? ` · ${quantity} card${quantity === 1 ? '' : 's'}` : ''}`,
    html: shell({
      preheader: `${referenceId} — ready to fulfil`,
      eyebrow: 'Payment captured',
      heading: 'You got paid',
      bodyHtml,
    }),
  };
}

// ─────────────────────────────────────────────────────────────────────
//  4. Invoice paid → your inbox
// ─────────────────────────────────────────────────────────────────────
/**
 * Fired by INVOICING.INVOICE.PAID — the event that matters now that
 * payment happens via an invoice you send after the email conversation,
 * rather than a checkout on the page.
 *
 * The invoice resource carries billing and shipping info directly, so
 * unlike a capture event there is no follow-up order fetch needed.
 */
function invoicePaidNotification(invoice) {
  const detail = invoice?.detail || {};
  const recipient = invoice?.primary_recipients?.[0] || {};
  const billing = recipient.billing_info || {};
  const shippingInfo = recipient.shipping_info || {};
  const addr = shippingInfo.address || {};

  const amount = invoice?.amount || {};
  const money = amount.value ? `${amount.value} ${amount.currency_code}` : '';

  const addressLines = [
    shippingInfo.name?.full_name,
    addr.address_line_1,
    addr.address_line_2,
    [addr.admin_area_2, addr.admin_area_1, addr.postal_code].filter(Boolean).join(', '),
    addr.country_code,
  ].filter(Boolean);

  const items = Array.isArray(invoice?.items) ? invoice.items : [];

  const bodyHtml = `
    <p style="margin:0 0 20px 0;">An invoice you sent has been paid. Time to start the work.</p>
    ${rows([
      ['Invoice', detail.invoice_number],
      ['Amount', money],
      ['Paid on', detail.payment_term?.due_date || new Date().toISOString().slice(0, 10)],
      ['Status', invoice?.status],
    ])}

    ${items.length ? `
      <p style="margin:26px 0 8px 0;font:500 11px/1.5 -apple-system,'Segoe UI',Arial,sans-serif;letter-spacing:.1em;text-transform:uppercase;color:${C.inkFaint};">Items</p>
      ${rows(items.map((it) => [
        it.name || 'Item',
        `${it.quantity || 1} × ${it.unit_amount?.value || '?'} ${it.unit_amount?.currency_code || ''}`,
      ]))}
    ` : ''}

    <p style="margin:26px 0 8px 0;font:500 11px/1.5 -apple-system,'Segoe UI',Arial,sans-serif;letter-spacing:.1em;text-transform:uppercase;color:${C.inkFaint};">Customer</p>
    ${rows([
      ['Name', [billing.name?.given_name, billing.name?.surname].filter(Boolean).join(' ')],
      ['Email', billing.email_address],
      ['Business', billing.business_name],
      ['Phone', billing.phones?.[0]?.national_number],
    ])}

    ${addressLines.length ? `
      <p style="margin:26px 0 8px 0;font:500 11px/1.5 -apple-system,'Segoe UI',Arial,sans-serif;letter-spacing:.1em;text-transform:uppercase;color:${C.inkFaint};">Ship to</p>
      <div style="padding:16px;background:${C.paperAlt};border-left:2px solid ${C.accent};font:400 15px/1.65 -apple-system,'Segoe UI',Arial,sans-serif;color:${C.ink};">
        ${addressLines.map(esc).join('<br>')}
      </div>
    ` : ''}`;

  return {
    subject: `Invoice paid — ${subjectSafe(money)}${detail.invoice_number ? ` (${subjectSafe(detail.invoice_number, 24)})` : ''}`,
    html: shell({
      preheader: `${detail.invoice_number || 'Invoice'} settled — ready to start`,
      eyebrow: 'Invoice paid',
      heading: 'You got paid',
      bodyHtml,
    }),
  };
}

module.exports = {
  esc,
  subjectSafe,
  invoicePaidNotification,
  leadNotification,
  leadConfirmation,
  paymentNotification,
};
