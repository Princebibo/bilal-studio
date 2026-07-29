# Bilal Studio — Backend

Lead capture API + PayPal payment notifications for the NFC Review Card &
Web Design landing page.

Node 18+ (uses global `fetch`). No build step.

## How the money actually flows

The site is **lead-generation only**. There is no checkout on the page.

```
visitor fills form  →  POST /api/lead  →  2 emails (you + them)
        ↓
you reply, agree scope and price over email
        ↓
you create a PayPal invoice in the PayPal dashboard/app and send it
        ↓
customer pays it  →  PayPal fires INVOICING.INVOICE.PAID
        ↓
POST /api/paypal-webhook  →  "you got paid" email with their shipping address
        ↓
you produce the card / build the site
```

You never touch code to take a payment. You send an invoice from PayPal;
the webhook just tells you it landed and gives you the address to ship to.

---

## Quick start

```bash
cd server
npm install
cp .env.example .env    # then fill it in — the server refuses to boot otherwise
npm run dev
```

Verify:

```bash
curl http://localhost:3000/health
```

---

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| `GET`  | `/health` | Liveness + store stats |
| `POST` | `/api/lead` | Lead form → 2 emails |
| `POST` | `/api/paypal-webhook` | Verified payment notifications |

That is the entire public surface. Three endpoints.

### Webhook events handled

| Event | When it fires | Why it's handled |
|---|---|---|
| `INVOICING.INVOICE.PAID` | Customer pays an invoice you sent | The primary path |
| `PAYMENT.CAPTURE.COMPLETED` | Any other inbound payment (PayPal.me link, money request) | Catch-all so no payment goes unnoticed |

Anything else gets a `200` so PayPal stops retrying it.

### Deliberately unmounted

`src/routes/checkout.js` and `src/pricing.js` are on disk, working and
tested, but **not mounted** — so `/api/create-paypal-order`,
`/api/capture-paypal-order` and `/api/pricing` all return 404. They're kept
in case you want an instant "pay now" option later. Re-enable with two lines;
see the comment at the top of `src/app.js`.

Unmounted means unreachable: no attack surface, no endpoint to secure.

---

## Two things that differ from the original brief

### 1. `@paypal/checkout-server-sdk` is not used — it's deprecated

PayPal archived that package; it no longer tracks API changes or receives
security fixes. It was always a thin wrapper over the Orders v2 REST calls,
so `src/paypal.js` makes those calls directly with `fetch`. Same official
API, one less unmaintained dependency.

If you specifically want the wrapper back, `createOrder` / `captureOrder`
in `src/paypal.js` are the only two functions to swap.

### 2. `body-parser` is not a separate dependency

`express.json()` **is** body-parser — bundled into Express since 4.16.
Installing it separately just pins a second copy.

---

## PayPal setup

### Where the money goes

To whichever account owns `PAYPAL_CLIENT_ID` / `PAYPAL_CLIENT_SECRET`.

There is deliberately **no merchant-email field** in the code. In Orders v2,
`purchase_units[].payee` exists for marketplace/third-party payouts and needs
granted permissions; pointing it at your own account is redundant and can
return `PAYEE_ACCOUNT_INVALID`.

**So: generate the REST credentials while logged in as the PayPal account
that should receive the money.** That is the entire configuration step —
there is no email to set anywhere in the code.

### Credentials

1. <https://developer.paypal.com/dashboard/> → log in as the receiving account
2. **Apps & Credentials** → Sandbox or Live → **Create App**
3. Copy Client ID + Secret into `.env`
4. Put the **Client ID** (public, safe to expose) into the frontend SDK
   `<script src="...client-id=...">` tag. **Never** the secret.

Sandbox and live credentials are separate. `PAYPAL_ENV` must match the
credentials you pasted, and must match the client id in the frontend.

### Webhook

1. Dashboard → your app → **Webhooks** → **Add Webhook**
2. URL: `https://yourdomain.com/api/paypal-webhook`
3. Subscribe to **both**:
   - **Invoice paid** (`INVOICING.INVOICE.PAID`) — the one that matters
   - **Payment capture completed** (`PAYMENT.CAPTURE.COMPLETED`) — catch-all
4. Copy the generated **Webhook ID** into `PAYPAL_WEBHOOK_ID`

Without that ID, every webhook is rejected — verification has nothing to
check against.

#### Testing webhooks locally

PayPal cannot reach `localhost`, so tunnel:

```bash
npx localtunnel --port 3000
```

Register the tunnel URL as the webhook, then use the Dashboard's
**Webhooks Simulator** to fire a `PAYMENT.CAPTURE.COMPLETED`.

Note: simulator events are signed for the simulator, so verification may
still fail against a real webhook id. A genuine sandbox purchase is the only
end-to-end test that exercises the real signature path.

---

## Email setup

### `MAIL_DRIVER=smtp` (Nodemailer)

Gmail needs an **App Password**, not your account password:
Google Account → Security → 2-Step Verification → App passwords → 16 chars.

### Deliverability warning

Gmail SMTP is fine for notifying **yourself**. It is a poor choice for the
**customer** confirmation:

- ~500 recipients/day cap
- you cannot set DKIM/SPF for a domain you don't own
- mail claiming to be your business but signed by `gmail.com` tends to land
  in Promotions or Spam

For customer-facing mail, use a transactional provider on your own domain
with SPF + DKIM + DMARC. Set `MAIL_DRIVER=sendgrid` and `SENDGRID_API_KEY`;
that is the only change needed.

---

## Security notes

| Control | Where |
|---|---|
| Webhook signature verification | `src/paypal.js` → `verifyWebhook` |
| Raw-body preservation for signing | `src/routes/webhook.js` + mount order in `src/app.js` |
| Cert URL host pinning (`*.paypal.com`) | `src/paypal.js` |
| Webhook idempotency | `src/orderStore.js` → `claimEvent` |
| HTML escaping of lead input into email | `src/templates.js` → `esc` |
| Control-char stripping (header injection) | `src/validate.js` → `stripControl` |
| Rate limiting (5 leads / 15 min / IP) | `src/routes/lead.js` |
| Honeypot spam trap | `src/validate.js` → `isSpam` |
| CORS allowlist, enforced in prod | `src/app.js` |
| Secret redaction in logs | `src/logger.js` |

### Mount order is load-bearing

In `src/app.js`, the webhook router is mounted **before** `express.json()`.
Signature verification hashes the exact bytes PayPal sent; if the JSON parser
consumes the stream first, the raw body is gone and verification fails on
100% of genuine events.

Do not reorder those two lines.

---

## Known limitation: the order store is in-memory

`src/orderStore.js` is a `Map` in process memory, used now only to
de-duplicate webhook events. It is wiped on restart and not shared across
instances, so de-duplication is best-effort: a restart mid-retry can send a
duplicate "you got paid" email.

That is the whole consequence — an extra email, occasionally. **The money is
never at risk**: PayPal is the source of truth, and you are the one who
created the invoice. To make it durable anyway, swap the method bodies for
Redis (`SET key val EX 172800`); the interface is four functions so the
change stays local.

---

## Deploying

1. Set every `.env` var in your host's dashboard (never commit `.env`)
2. `NODE_ENV=production`
3. `CORS_ORIGINS=https://yourdomain.com` — required; boot fails if unset
4. `PAYPAL_ENV=live` + live credentials
5. Update the webhook URL to the production domain and swap in the new
   webhook id (live and sandbox webhooks have different IDs)
6. Point `API_BASE` at the deployed API — it's near the top of the `<script>`
   block at the bottom of `../index.html`

Behind a proxy, `app.set('trust proxy', 1)` is already handled in
`src/app.js` when `NODE_ENV=production`.

### Pre-launch checks

```bash
curl https://api.yourdomain.com/health

# Should be 401 — proves signature verification is active
curl -X POST https://api.yourdomain.com/api/paypal-webhook \
  -H 'Content-Type: application/json' -d '{"id":"x"}'

# Should be 422 with per-field errors — proves validation is active
curl -X POST https://api.yourdomain.com/api/lead \
  -H 'Content-Type: application/json' -d '{"fullName":"A"}'
```

Then submit the real form once and confirm **both** emails arrive — the
notification to you and the confirmation to the address you used. After that,
send yourself a $1 PayPal invoice from the dashboard, pay it, and confirm the
"you got paid" email lands.

---

## Layout

```
server/
├─ server.js            process entry: bind port, handle signals
├─ .env.example
└─ src/
   ├─ app.js            Express assembly (importable, does not listen)
   ├─ config.js         env validation, fail-fast
   ├─ logger.js         structured JSON logs + secret redaction
   ├─ paypal.js         REST client + webhook verification
   ├─ mailer.js         nodemailer / sendgrid driver switch
   ├─ templates.js      HTML emails (escaped)
   ├─ validate.js       lead validation + honeypot
   ├─ orderStore.js     webhook dedupe (in-memory)
   ├─ pricing.js        [unmounted] price tiers
   └─ routes/
      ├─ lead.js
      ├─ webhook.js
      └─ checkout.js    [unmounted] instant-checkout routes
```

The form lives in `../index.html` — inline in the contact section, submitted
with `fetch`, no page reload. Set `API_BASE` in that file's script block.

## Prices shown on the site

`$30–$45` for cards and "per project" for websites are **static copy** in
`index.html` now — the page states a range and you confirm the exact figure
over email. There is no price calculation in the request path any more.
