# Product photos

Save the six product photos here, using **exactly** these filenames. The page
references them by name — any other name and the slot stays a placeholder.

| Filename | Which photo | Price on site |
|---|---|---|
| `nfc-card-google-white.jpg` | Stack of white "Review us on Google" cards on a wood desk | $30 |
| `nfc-card-wood.jpg` | Single wood NFC card on a dark table | $15 |
| `nfc-stand-acrylic-google.jpg` | Clear acrylic stand, "Notez-nous sur Google", NFC + QR | $35 |
| `nfc-stand-google-dark.jpg` | Black counter sign, "Review us on Google", TAP or SCAN | $40 |
| `nfc-wristband-fabric.jpg` | Black fabric wristband with the NFC logo | $25 |
| `nfc-wristband-kids-security.jpg` | Black "SECURITY BRACELET FOR KIDS" wristband | $25 |

## Before you upload

**Crop to 4:5 portrait.** The page renders every tile at a 4:5 aspect ratio with
`object-fit: cover`, so anything else gets cropped from the centre — and a
product sitting off-centre will lose its edges.

**Resize to about 800×1000 px.** The tiles are never displayed larger than
~400 px wide, so 800 px covers retina screens with nothing wasted.

**Compress before committing.** Phone photos are often 3–5 MB each; six of
those would make the page slower than everything else on it combined. Aim for
under 150 KB per image — [squoosh.app](https://squoosh.app) does this in the
browser with no upload.

**Keep `.jpg`.** If you prefer `.webp` (smaller, equally well supported), rename
the `src` and `data-label` attributes in `index.html` to match.

## If a photo is missing

The slot shows a hatched placeholder with the expected filename printed in it,
rather than a broken-image icon. That is deliberate — the page stays presentable
while photos are still being prepared, and the placeholder tells you exactly
which file is absent.

## Licensing

Some of the source images carry third-party branding ("ConnectWare",
"Guardian Pulse Collection"). If those are your supplier's catalogue photos,
reseller use is normally fine — confirm with them. If they belong to another
retailer, replace them with your own photographs before the site takes traffic.
