# PDF report fonts

These TTF files are bundled into the backend image and registered with PDFKit
at runtime so generated reports render correctly in non-Latin scripts.

| File | Used for | License |
|------|----------|---------|
| `Roboto-Regular.ttf` | Body text in all locales | Apache-2.0 (see `LICENSE.txt`) |
| `Roboto-Bold.ttf` | Headings, totals, table headers | Apache-2.0 |

## Why a TTF instead of PDFKit's built-in `Helvetica`?

PDFKit's bundled fonts are AFM (Adobe Font Metrics) — Latin-1 only. Russian /
Kazakh / Greek / etc. glyphs render as `□□□` boxes or garbage.

Roboto includes Latin Extended + Cyrillic + Greek + Vietnamese (~500KB per
weight) — covers `en, ru, kk, es, de, fr, pt`.

## CJK locales (`zh, ja, ko`)

Roboto does NOT include CJK glyphs. For those locales the PDF will fall back to
PDFKit's built-in fonts and Chinese / Japanese / Korean characters will not
render correctly. To fix this, drop the matching Noto Sans subset here and
extend `pdf-fonts.ts`:

- `NotoSansSC-Regular.ttf` / `NotoSansSC-Bold.ttf` (Simplified Chinese, ~4MB)
- `NotoSansJP-Regular.ttf` / `NotoSansJP-Bold.ttf` (Japanese, ~4MB)
- `NotoSansKR-Regular.ttf` / `NotoSansKR-Bold.ttf` (Korean, ~3MB)

Files of that size shouldn't go in the application repo — fetch them in the
Dockerfile from a known mirror or ship them as a Docker layer instead.
