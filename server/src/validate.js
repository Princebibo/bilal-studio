'use strict';

/**
 * Input validation for the lead form.
 *
 * Hand-rolled rather than pulled from a schema library: it is ~90 lines,
 * has no version drift, and every rule is visible in one screen. If this
 * grows past a handful of shapes, swap in zod.
 *
 * Returns collected errors keyed by field so the frontend can highlight
 * them, instead of failing on the first problem it finds.
 */

const SERVICES = [
  'NFC Review Card',
  'Web Design',
  'Both',
  'Other',
];

// Deliberately permissive. Over-strict email regexes reject valid
// addresses (new TLDs, plus-addressing, apostrophes) and lose you real
// leads. The only reliable validation is sending mail to it.
const EMAIL_RE = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

const LIMITS = {
  fullName: 120,
  email: 254,           // RFC 5321 maximum
  phone: 32,
  businessName: 160,
  service: 60,
  notes: 4000,
};

const TAB = 9;
const LF = 10;
const DEL = 127;
const FIRST_PRINTABLE = 32;

/**
 * Remove C0/C1 control characters by code point.
 *
 * Done with a codepoint scan rather than a regex so that no literal control
 * bytes appear in this source file. Control characters are stripped because
 * they corrupt email headers (a bare CR/LF in a name field is the classic
 * header-injection vector) and can hide content from log readers.
 *
 * @param {*} value
 * @param {boolean} keepNewlines  Preserve \n and \t (for textarea input).
 */
function stripControl(value, keepNewlines) {
  let out = '';
  for (const ch of String(value)) {
    const code = ch.codePointAt(0);
    const isControl = code < FIRST_PRINTABLE || code === DEL;

    if (!isControl) { out += ch; continue; }
    if (keepNewlines && (code === LF || code === TAB)) { out += ch; continue; }
    // Single-line fields: collapse the control char to a space so words
    // do not get glued together. Multiline: drop it.
    if (!keepNewlines) out += ' ';
  }
  return out;
}

/** Trim, collapse runs of whitespace, strip control characters. */
function clean(value, max) {
  if (value == null) return '';
  return stripControl(value, false)
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

/** Notes keep their line breaks — only strip control chars and cap length. */
function cleanMultiline(value, max) {
  if (value == null) return '';
  return stripControl(String(value).replace(/\r\n/g, '\n'), true)
    .replace(/\n{4,}/g, '\n\n\n')
    .trim()
    .slice(0, max);
}

/**
 * @param {object} body  Raw req.body
 * @returns {{ok: true, data: object} | {ok: false, errors: Record<string,string>}}
 */
function validateLead(body = {}) {
  const errors = {};

  const data = {
    fullName: clean(body.fullName, LIMITS.fullName),
    email: clean(body.email, LIMITS.email).toLowerCase(),
    phone: clean(body.phone, LIMITS.phone),
    businessName: clean(body.businessName, LIMITS.businessName),
    service: clean(body.service, LIMITS.service),
    notes: cleanMultiline(body.notes, LIMITS.notes),
  };

  if (data.fullName.length < 2) {
    errors.fullName = 'Please enter your name.';
  }

  if (!data.email) {
    errors.email = 'Please enter your email address.';
  } else if (!EMAIL_RE.test(data.email)) {
    errors.email = 'That email address does not look right.';
  }

  // Phone is required by the brief. Validate shape loosely — international
  // formats vary wildly and a strict pattern rejects real numbers.
  if (!data.phone) {
    errors.phone = 'Please enter a phone number.';
  } else {
    const digits = data.phone.replace(/\D/g, '');
    if (digits.length < 7 || digits.length > 15) {
      errors.phone = 'Please enter a valid phone number.';
    }
  }

  if (data.businessName.length < 2) {
    errors.businessName = 'Please enter your business name.';
  }

  if (!data.service) {
    errors.service = 'Please choose a service.';
  } else if (!SERVICES.includes(data.service)) {
    // Unknown value means a tampered or stale form — accept the lead but
    // normalise it rather than dropping a potentially real enquiry.
    data.service = 'Other';
  }

  return Object.keys(errors).length
    ? { ok: false, errors }
    : { ok: true, data };
}

/**
 * Honeypot spam check.
 *
 * The frontend renders a field that is hidden from humans via CSS. Bots
 * that fill every input will populate it; real users cannot. Costs nothing
 * and stops a surprising amount of low-effort form spam without a CAPTCHA.
 *
 * @returns {boolean} true if the submission looks automated
 */
function isSpam(body = {}) {
  /* `_gotcha` is the name the frontend uses — it is also Formspree's
     built-in trap name, so the same field works whichever transport the
     site is pointed at. The others are kept for older form markup. */
  const traps = [body._gotcha, body._company_url, body.website_url];
  return traps.some((v) => String(v ?? '').trim().length > 0);
}

module.exports = { validateLead, isSpam, SERVICES, LIMITS };
