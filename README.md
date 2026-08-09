# Bilal Studio

Landing page for an independent studio selling **NFC Google Review Cards** and
**custom website design** to local businesses.

French by default, with an English toggle. Lead-generation only — no checkout
on the page; pricing is agreed over email and invoiced afterwards.

## Stack

No build step, no framework. One self-contained HTML file plus an optional
Node backend.

| | |
|---|---|
| Page | Single `index.html` — inlined CSS/JS |
| Type | Fraunces (display) + Inter (UI), via Google Fonts |
| Motion | GSAP + ScrollTrigger + Lenis, from CDN |
| Imagery | **None** — all visuals are authored inline SVG, CSS, and type |
| Form | Formspree by default; switchable to the Node API |
| Backend | Express (optional) — lead emails + PayPal invoice webhooks |

## Run it

```bash
npx --yes serve@14 --listen 5173 .
```

Then open <http://localhost:5173>.

Serving over `http://` matters: opening `index.html` as a `file://` URL sends
`Origin: null`, which form providers can reject — a working form will look
broken.

## Configure the form

Everything lives in one `CONFIG` object near the top of the `<script>` block
in `index.html`:

```js
const CONFIG = {
  mode: 'formspree',        // or 'api' for the Node backend
  formspreeId: '…',         // from https://formspree.io/f/XXXXXXXX
  apiBase: '…',             // used when mode is 'api'
  fallbackEmail: '…',       // prefills a mailto: if the network fails
};
```

The two transports sit behind one adapter, so switching is a one-line change.

## Backend (optional)

See [`server/README.md`](server/README.md). It handles lead notification +
customer confirmation emails, and verified PayPal webhooks for invoice
payments. It is not required for the page to collect leads.

Copy `server/.env.example` to `server/.env` and fill it in — the server
validates its config at boot and refuses to start if anything is missing.

## Notes

- **Accessibility:** semantic landmarks, one `h1` with no skipped levels,
  labelled form fields with `aria-describedby` error wiring, `aria-pressed`
  on the language switch, visible focus rings, and a full
  `prefers-reduced-motion` path that renders everything static.
- **i18n:** French is the source of truth in the HTML; English lives in a
  dictionary and swaps via `data-i18n` keys. `<option value>` attributes stay
  English in both languages so submitted data is stable.
- **Product photos** live in `images/` — see [`images/README.md`](images/README.md)
  for the exact filenames and sizing. A missing photo renders as a labelled
  placeholder, never a broken-image icon.
- **Design constraint:** apart from product photography, every visual is
  authored SVG, CSS and type. A single accent colour appears exactly six times.

## Licence

MIT
