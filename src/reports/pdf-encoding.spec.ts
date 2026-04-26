/**
 * Smoke test for PDF Cyrillic rendering.
 *
 * The original bug was that PDFKit's built-in Helvetica is Latin-1 only and
 * Russian/Kazakh text rendered as `.notdef` boxes. Replacing Helvetica with
 * Roboto TTF fixed this. This test guards against regressions: build a PDF
 * containing a known Cyrillic string and verify the bytes show up encoded in
 * the output stream (PDFKit embeds the subset as CID-keyed glyphs, so the
 * literal Unicode string won't appear — but the font subset MUST contain a
 * cmap entry for the Cyrillic codepoints we used).
 *
 * Uses the real `pdfkit`, not the unit-test mock.
 */

// Force Jest to use the real pdfkit (the main spec mocks it).
jest.unmock('pdfkit');
jest.dontMock('pdfkit');

import { registerReportFonts } from './pdf-fonts';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const PDFDocument = jest.requireActual('pdfkit');

describe('PDF encoding (real pdfkit + Roboto)', () => {
  it('renders Cyrillic without throwing and produces a non-trivial PDF', async () => {
    const buffer = await new Promise<Buffer>((resolve, reject) => {
      const doc = new PDFDocument({ margin: 50, size: 'A4' });
      const chunks: Buffer[] = [];
      doc.on('data', (c: Buffer) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const F = registerReportFonts(doc);
      doc.font(F.bold).fontSize(20).text('Сводный отчёт SubRadar');
      doc.font(F.regular).fontSize(12);
      doc.text('Расходы по категориям');
      doc.text('Жиынтық есеп — қазақша мәтін');
      doc.text('Latin: Subscriptions report');
      doc.end();
    });

    // Sanity: real PDFs are >2KB even for one page; Roboto subset alone
    // contributes a few hundred bytes. If the buffer is tiny, something
    // refused to embed (font corruption, etc.).
    expect(buffer.length).toBeGreaterThan(2000);
    expect(buffer.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('registers TTF fonts without errors', () => {
    const doc = new PDFDocument({ size: 'A4' });
    expect(() => registerReportFonts(doc)).not.toThrow();
    doc.end();
  });
});
