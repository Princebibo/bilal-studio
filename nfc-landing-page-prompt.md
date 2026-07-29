# BUILD PROMPT — NFC Review Cards + Web Design Agency Landing Page

## 0. ROLE

You are a senior front-end design engineer with a background in luxury brand digital work — think Aesop, Linear, Vercel, Stripe, Arc. You write restrained, confident interfaces. You have strong opinions about typographic rhythm and you refuse to ship anything that looks like a template.

Build a **single-page marketing site** for an independent agency selling two products to local business owners:
1. Custom NFC Google Review Cards
2. High-performance custom website design

The audience is a **busy, non-technical local business owner** — a barber, dentist, café owner, detailer, gym operator. They are skeptical of agencies, allergic to jargon, and decide in under 15 seconds whether a site looks legitimate. The page must read as *expensive and trustworthy*, because the trust is the product.

---

## 1. HARD CONSTRAINTS

**Absolutely no images.** No stock photos, no Unsplash, no AI-generated imagery, no illustration libraries, no photographic placeholders. Every visual must be constructed from typography, layout, negative space, hairline rules, CSS gradients/masks/blend modes, inline SVG that *you* author, and motion. This is a discipline constraint — the design must be strong enough to survive without imagery.

**Deliverable:** one self-contained `index.html` with inlined `<style>` and `<script>` — no build step, no external stylesheets, no component libraries. Google Fonts via `<link>` is permitted. GSAP + ScrollTrigger + Lenis via CDN is permitted. Nothing else.

**Do not use:** purple/indigo→pink gradients, glassmorphism blur cards, emoji as icons, nested rounded cards inside rounded cards, drop shadows on everything, "Lorem ipsum," fake logo bars labeled "As seen in," fabricated testimonials, invented statistics, invented review counts, or any claim not supplied in Section 5. If a section feels thin without social proof, solve it with layout and copy — not fiction.

---

## 2. ART DIRECTION

### Palette — sophisticated neutral + one restrained accent

Build a warm, near-monochrome foundation. Warm neutrals read as premium; cool grays read as generic SaaS.

```
--ink:        #14110F   /* near-black, warm-biased — primary text, dark sections */
--ink-soft:   #4A4441   /* secondary text */
--ink-faint:  #8B8480   /* tertiary, labels, captions */
--paper:      #FAF8F5   /* page background — warm off-white, never pure #FFF */
--paper-alt:  #F2EEE8   /* alternating section band */
--rule:       #E2DCD3   /* hairline borders */
--accent:     #B4522B   /* burnt sienna — the single accent */
--accent-tint:#FBEDE6
```

Choose **one** accent and commit. Burnt sienna `#B4522B` is the default recommendation — it is warm, confident, and unclaimed by the SaaS category. Acceptable alternatives: deep olive `#4A5D3A`, or ink-blue `#1F3A5F`. **Do not use two accents.** Do not tint neutrals with the accent hue.

Accent usage budget — the accent appears **no more than 6 times** on the entire page:
- Primary CTA button fill (×2 — hero and closing)
- The eyebrow label above the hero headline
- One word or phrase emphasized in the headline
- The price figure
- Active/hover state of the pricing card border

Everything else is neutral. Restraint *is* the luxury signal.

### Typography

Two families, maximum. Pair a high-contrast display serif against a neutral grotesque:

- **Display:** `Fraunces` (variable, use `wght 400–600`, `SOFT 0`, `WONK 1` for character) — or `Instrument Serif`, or `Newsreader`
- **Body/UI:** `Inter` at `-0.011em` tracking — or `Geist`, or `Satoshi`

Type scale — fluid, using `clamp()`. Do not use a linear scale; use a modular ratio near 1.25 at small sizes widening to ~1.4 at display sizes:

```
--fs-display: clamp(2.75rem, 7.5vw, 6.5rem)   /* hero H1 */
--fs-h2:      clamp(2rem, 4.5vw, 3.5rem)
--fs-h3:      clamp(1.25rem, 2vw, 1.625rem)
--fs-lead:    clamp(1.0625rem, 1.5vw, 1.3125rem)
--fs-body:    1.0625rem
--fs-label:   0.75rem   /* uppercase, tracking 0.14em, --ink-faint */
```

Typographic rules that are not optional:
- Hero H1: `line-height: 0.94`, `letter-spacing: -0.035em`, `text-wrap: balance`
- Body copy: `line-height: 1.65`, `max-width: 62ch`, `text-wrap: pretty`
- Every section is introduced by a small uppercase eyebrow label (e.g. `01 — THE PROBLEM`), set in `--fs-label`
- Use real typographic characters: `—` em dashes, `’` curly apostrophes, `$30–$45` with an en dash
- Numerals in the pricing block use `font-variant-numeric: tabular-nums`

### Layout & space

- 12-column grid, `max-width: 1240px`, gutters `clamp(1.25rem, 5vw, 5rem)`
- **Asymmetry is mandatory.** Never center-align three consecutive sections. Alternate: hero left-aligned to column 1–8 → benefits full-bleed grid → services offset right → closing centered. The rhythm of alignment changes is what makes the page feel designed rather than assembled.
- Vertical section padding: `clamp(6rem, 14vh, 11rem)`. Be braver with whitespace than feels comfortable — then add 20%.
- Separate sections with hairline `1px solid var(--rule)` rules and background band changes, **not** with card containers. Minimize boxes.
- Optical alignment over mathematical: hang punctuation, pull large display type slightly left of the grid line.

---

## 3. MOTION SPEC

Motion should feel like weight and momentum, not decoration. Every animation earns its place by directing attention.

**Smooth scroll — Lenis:**
```js
const lenis = new Lenis({ duration: 1.1, easing: t => Math.min(1, 1.001 - Math.pow(2, -10 * t)), smoothWheel: true });
```
Wire Lenis into GSAP's ticker and `ScrollTrigger.scrollerProxy` so ScrollTrigger stays in sync. Verify no scroll-jank on trackpad.

**Motion vocabulary — use these consistently:**

| Element | Behavior |
|---|---|
| Hero headline | Masked line-by-line reveal. Wrap each line in `overflow:hidden`, animate inner spans `y: 105% → 0%`, stagger `0.07s`, `duration: 1.1`, `ease: "expo.out"`. Fires on load, not scroll. |
| Hero sub + CTA | Fade + `y: 16 → 0`, delayed `0.5s` behind the headline |
| Section eyebrows | Hairline rule draws horizontally (`scaleX 0→1`, `transform-origin: left`) as the label fades in |
| Benefit cards | Stagger in on scroll, `y: 28 → 0`, `stagger: 0.08`, trigger at `top 78%` |
| Large display type | Subtle parallax — `yPercent: -6` across its scroll range |
| Price figure | Count-up from 0 → 30 when scrolled into view, once only |
| Buttons | Accent fill wipes upward from bottom on hover, `0.35s cubic-bezier(.22,1,.36,1)`; label shifts `y: -1px` |
| Text links | Underline scales from left, `0.3s` |

**Non-negotiables:**
- One shared easing family — `expo.out` / `cubic-bezier(0.16, 1, 0.3, 1)`. Never `ease-in-out` on entrances.
- Durations 0.3–1.2s. Nothing slower; nothing that makes the user wait.
- Entrances animate **once** (`toggleActions: "play none none none"`). Content that re-animates on scroll-up is a bug.
- No layout shift, ever. Animate `transform` and `opacity` only.
- `@media (prefers-reduced-motion: reduce)` must disable Lenis, kill all ScrollTriggers, and render every element in its final visible state. Test this path.

---

## 4. PAGE ARCHITECTURE

```
① NAV          — minimal, fixed, translucent-on-scroll
② HERO         — headline, subhead, dual CTA, scroll cue
③ BENEFITS     — 4-item grid, numbered
④ HOW IT WORKS — 3 steps, horizontal rhythm
⑤ SERVICE 01   — NFC Review Cards + price
⑥ SERVICE 02   — Web Design
⑦ VALUE / ROI  — the argument, typographically driven
⑧ FAQ          — 4 items, accordion
⑨ CLOSING CTA  — full-bleed dark, maximum contrast
⑩ FOOTER       — spare
```

---

## 5. SECTION SPECIFICATIONS & EXACT COPY

Copy marked **[VERBATIM]** must appear exactly as written. Copy marked **[WRITE]** is yours to author — match the register: plain-spoken, confident, benefit-first, zero jargon, short sentences. Never say "leverage," "solutions," "elevate," "unlock," "game-changing," or "revolutionize."

---

### ① NAV
Left: wordmark set in the display serif — the agency name as a text lockup, tight tracking. Right: `Services` · `How It Works` · `FAQ`, then a small outlined `Get Started` button.

Transparent at rest. On scroll past 80px: `backdrop-filter: blur(12px)`, `background: rgba(250,248,245,0.82)`, and a `1px` bottom hairline fade in. Mobile: collapse links into a minimal full-screen overlay with staggered link reveal.

---

### ② HERO

Left-aligned across columns 1–8. Not centered — centered hero copy is the single strongest signal of a template.

**Eyebrow** [VERBATIM]
> ONE TAP. MORE REVIEWS. MORE CUSTOMERS.

**H1** [VERBATIM] — set at `--fs-display`. Break across lines deliberately, and set **"Faster"** in the accent color, italic display serif:
> Grow Your Business Faster with an NFC Google Review Card & Custom Websites

**Subheadline** [VERBATIM] — `--fs-lead`, `--ink-soft`, `max-width: 54ch`:
> Want more Google reviews, higher website traffic, and better visibility for your business? With an NFC Google Review Card, your customers can leave a Google review instantly with just one tap—no searching, no hassle.

**CTAs:** primary solid accent — `Order Your Card` · secondary ghost/underlined — `See Website Packages`. Beneath, in `--fs-label`: [WRITE] a single reassurance line covering *one-time purchase, no subscription, no app required*.

**Right side of grid (columns 9–12):** an authored SVG composition — a card rectangle at a slight rotation with a concentric NFC wave arc emanating from one corner, drawn in hairline `--rule` strokes with the innermost arc in `--accent`. Animate the arcs on a slow `2.4s` staggered pulse loop, opacity `0.35 → 0`. Pure line art, no fill, no shadow.

**Bottom of viewport:** a thin vertical line, `48px` tall, animating downward on a loop, with `SCROLL` rotated 90° in `--fs-label`.

---

### ③ BENEFITS — 4-item grid

**Eyebrow:** `01 — WHY IT WORKS`
**Section heading:** [WRITE] one line, ~7 words, on the theme of reviews driving local discovery.

Four items, **not cards** — separated by hairline rules only, on the `--paper` background. Each: a large `01`–`04` numeral in the display serif at `--ink-faint`, the benefit as an `--fs-h3` statement, and one supporting sentence in `--ink-soft`.

Benefit statements [VERBATIM]:
1. Increase your Google reviews faster
2. Improve your online reputation
3. Drive more traffic to your website
4. Make it easy for customers to connect with your business

Supporting sentences: [WRITE] one per benefit, max 14 words each.

Layout: 4-up on desktop (`grid-template-columns: repeat(4,1fr)` with vertical hairline dividers between), 2-up tablet, stacked mobile.

---

### ④ HOW IT WORKS

**Eyebrow:** `02 — THE PROCESS`
Three steps, arranged on a horizontal axis with a hairline rule connecting them. [WRITE] each step title (2–4 words) and one-sentence description, covering:
1. You send your business details and Google profile
2. We build and personalize your card
3. Customers tap — a review page opens instantly

Animate the connecting rule drawing left→right as the section enters the viewport, with each step's content fading in as the line reaches it.

---

### ⑤ SERVICE 01 — NFC GOOGLE REVIEW CARDS

**Eyebrow:** `03 — SERVICE ONE`
Asymmetric split: heading and body in columns 1–6, pricing block in columns 8–12.

**Heading:** [VERBATIM] `NFC Google Review Cards`

**Body** [VERBATIM]:
> Personally customized with all of your business information, making it simple for customers to access your Google profile and leave a review in seconds.

**Beneath:** [WRITE] 4 short spec lines — hairline-separated, label:value format — covering *customization, durability, compatibility (works with any modern smartphone), and setup time*.

**Pricing block** — the only bordered element on the page. `1px solid var(--rule)`, `border-radius: 4px` maximum (near-square reads more premium than pill), generous internal padding, no shadow. On hover the border transitions to `--accent`.

Inside — [VERBATIM] price, treated as the typographic hero of the block:
> **Special Price: Only $30–$45** *(one-time purchase)*

Set `$30–$45` at `clamp(2.5rem, 5vw, 4rem)` in the display serif, accent-colored, tabular numerals. `Special Price` above as an `--fs-label` eyebrow. `one-time purchase` below in `--ink-faint` italic. Add [WRITE] a one-line note explaining what determines position in the range (design complexity / quantity). Then a full-width accent CTA: `Order Your Card`.

---

### ⑥ SERVICE 02 — PROFESSIONAL WEB DESIGN

**Eyebrow:** `04 — SERVICE TWO`
**Mirror the previous section's asymmetry** — content now right-weighted (columns 7–12). Place on the `--paper-alt` band to mark the shift.

**Heading:** [VERBATIM] `Professional Web Design`

**Body** [VERBATIM]:
> Custom, modern websites built to convert visitors into paying clients and drive local growth.

**Supporting:** [WRITE] 5 deliverable lines as a hairline-separated list — covering *mobile-first responsive build, speed/Core Web Vitals, local SEO foundations, conversion-focused layout, and Google Business Profile integration*. Then a text CTA: `Request a Quote →`.

**Do not invent website pricing.** No fabricated tiers or figures. Use [WRITE] `Pricing scoped to your project — quotes returned within 24 hours` or similar honest framing.

---

### ⑦ VALUE PROPOSITION / ROI

The page's persuasive climax. **Typography carries this section entirely** — no cards, no icons, no grid. Centered, narrow measure (`max-width: 46rem`), maximum vertical breathing room.

**Eyebrow:** `05 — THE MATH`

**Large pull-statement** at `--fs-h2` in the display serif: [WRITE] 2 lines framing both products as small, one-time, high-ROI investments — the argument being that a single new customer earned through better reviews or a better website repays the cost many times over. Emphasize *one* clause in accent italic.

Below, two or three short supporting paragraphs at `--fs-lead`. [WRITE] them around this logic, stated as reasoning rather than as invented statistics:
- Local customers check Google reviews before choosing
- More reviews → higher local ranking → more discovery
- A slow or dated website loses the customer the reviews earned
- Both fixes are one-time costs against ongoing return

**Critical:** make the ROI argument through clear reasoning and confident sentence construction. Do **not** manufacture percentages, "studies show," or specific figures.

---

### ⑧ FAQ

**Eyebrow:** `06 — QUESTIONS`
Four accordion items. Hairline-separated rows, no card containers. `+ → ×` rotating indicator; animate height with GSAP, not a CSS `max-height` hack. Use real `<button aria-expanded>` semantics.

[WRITE] four Q&A pairs answering:
1. How does the NFC card actually work?
2. Do customers need to download an app?
3. What do you need from me to get started?
4. Do you offer both the card and a website together?

Answers: 2–3 sentences, plain language, no hedging.

---

### ⑨ CLOSING CTA

Full-bleed `--ink` background — the page's only dark section, which makes it the visual full stop. Centered, tall (`min-height: 78vh`), enormous whitespace.

Invert the palette: `--paper` text, `--accent` retained for the button.

**Heading** [VERBATIM], at `--fs-display`, `text-wrap: balance`:
> Order your card or claim your website today and start growing your business with just one tap.

Set **"just one tap"** in accent italic display serif.

Two CTAs beneath: primary accent `Order Your Card` · secondary outlined-in-paper `Claim Your Website`. Below, in `--fs-label` at reduced opacity: [WRITE] a short line on response time or availability.

Add a very low-contrast (`opacity: 0.04`) oversized display-serif watermark of the accent — a single word or the wordmark — bleeding off one edge, with slow parallax. Subtle enough that it reads as texture, not decoration.

---

### ⑩ FOOTER

Three columns on `--ink`, separated from the CTA by a `1px rgba(255,255,255,0.1)` rule. Wordmark + one-line descriptor · nav links · contact + one honest trust line. `--fs-label` throughout, generous letter-spacing. Copyright bottom-right.

---

## 6. ENGINEERING REQUIREMENTS

**Accessibility**
- Semantic landmarks: `<header> <main> <section aria-labelledby> <footer>`
- One `<h1>`; heading levels never skip
- All text ≥ 4.5:1 contrast — verify accent-on-paper and paper-on-ink
- Visible `:focus-visible` ring in `--accent`, `2px` offset — never `outline: none` without a replacement
- Accordion: real buttons, `aria-expanded`, `aria-controls`, keyboard operable
- Skip-to-content link
- `prefers-reduced-motion` fully honored

**Performance**
- Preconnect to `fonts.gstatic.com`; `display=swap`; subset to `latin`
- Load only weights actually used
- GSAP/Lenis deferred; page must render readable content with JS disabled — **no `opacity: 0` initial states that persist without JS**. Set initial states in JS with `gsap.set()`, not in CSS.
- Target: no CLS, first paint under 1.5s on 4G

**Responsive**
- Fluid from 320px to 1920px+. Test 375, 768, 1024, 1440.
- Mobile: display type down to `2.75rem`, section padding to `5rem`, all grids to single column, tap targets ≥ 44px
- Mobile hero must still be left-aligned and still have breathing room — do not compress it into a centered block

---

## 7. SELF-CRITIQUE BEFORE DELIVERY

Review your own output against each item. Fix anything that fails.

- [ ] Does this look like it cost $8,000, or like a template with the colors changed?
- [ ] Would a business owner trust this within 5 seconds?
- [ ] Is every piece of [VERBATIM] copy present and exact?
- [ ] Did I invent any statistic, testimonial, client name, or price not supplied?
- [ ] Does the accent appear 6 times or fewer?
- [ ] Are three or more consecutive sections centered? (If yes, break one.)
- [ ] Is there a single instance of a rounded card nested inside another rounded card?
- [ ] Does every animation use the same easing family?
- [ ] Does anything animate twice on scroll-up?
- [ ] With JS disabled, is all content visible?
- [ ] With `prefers-reduced-motion: reduce`, is the page fully usable and fully visible?
- [ ] Is any element visually centered when it should be optically aligned?
- [ ] Is the whitespace genuinely generous, or merely adequate?
- [ ] Read every sentence aloud — does any of it sound like marketing filler? Cut it.

Ship one file. Make it impeccable.
