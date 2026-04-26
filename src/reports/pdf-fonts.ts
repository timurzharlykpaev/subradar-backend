import * as path from 'path';
import * as fs from 'fs';

/**
 * Bundled TTF paths. Resolved relative to this file so they survive the
 * `dist/` compile step (we mirror them under `dist/reports/fonts/` via
 * `nest-cli.json` `assets`).
 *
 * Roboto covers Latin + Cyrillic + Greek (~500KB per weight). For CJK
 * (zh/ja/ko) PDFKit falls back to its built-in Helvetica and glyphs
 * will not render — see `fonts/README.md`.
 */
const FONT_DIR = path.join(__dirname, 'fonts');
const REGULAR = path.join(FONT_DIR, 'Roboto-Regular.ttf');
const BOLD = path.join(FONT_DIR, 'Roboto-Bold.ttf');

export const FONT_REGULAR = 'Body';
export const FONT_BOLD = 'BodyBold';

let cached: { regular: Buffer; bold: Buffer } | null = null;

/**
 * Read TTF bytes once per process and cache them — `doc.registerFont` accepts
 * a Buffer, which keeps PDFKit from re-reading the file for every report.
 */
function loadFontBuffers(): { regular: Buffer; bold: Buffer } {
  if (cached) return cached;
  cached = {
    regular: fs.readFileSync(REGULAR),
    bold: fs.readFileSync(BOLD),
  };
  return cached;
}

/**
 * Call once on every PDFDocument before drawing any text. Idempotent per
 * document — registering the same name twice is a no-op in PDFKit.
 *
 * Returns the font names (`Body`, `BodyBold`) to use in `doc.font(...)`.
 */
export function registerReportFonts(doc: any): {
  regular: string;
  bold: string;
} {
  const buffers = loadFontBuffers();
  doc.registerFont(FONT_REGULAR, buffers.regular);
  doc.registerFont(FONT_BOLD, buffers.bold);
  return { regular: FONT_REGULAR, bold: FONT_BOLD };
}
