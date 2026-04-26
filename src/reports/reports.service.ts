import {
  Injectable,
  Inject,
  NotFoundException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { InjectQueue } from '@nestjs/bull';
import type { Queue } from 'bull';
import { Repository, Between } from 'typeorm';
import Decimal from 'decimal.js';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../common/redis.module';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const PDFDocument = require('pdfkit');
import { Report, ReportType, ReportStatus } from './entities/report.entity';
import { Subscription } from '../subscriptions/entities/subscription.entity';
import { PaymentCard } from '../payment-cards/entities/payment-card.entity';
import { User } from '../users/entities/user.entity';
import { FxService } from '../fx/fx.service';
import { registerReportFonts } from './pdf-fonts';
import { pdfL, ReportI18n } from './pdf-i18n';

const PDF_TTL_SECONDS = 3600;

// ─── Colors ───────────────────────────────────────────────────────────────
const C = {
  primary: '#6C47FF',
  primaryLight: '#8B6AFF',
  green: '#10B981',
  red: '#EF4444',
  orange: '#F59E0B',
  text: '#1A1A1A',
  textLight: '#666666',
  textMuted: '#999999',
  border: '#E5E7EB',
  headerBg: '#6C47FF',
  rowEven: '#F9FAFB',
  white: '#FFFFFF',
  insightBg: '#F4F0FF',
};

const CATEGORY_COLORS: Record<string, string> = {
  STREAMING: '#E50914', MUSIC: '#1DB954', AI_SERVICES: '#10A37F', PRODUCTIVITY: '#3B82F6',
  GAMING: '#8B5CF6', DESIGN: '#A259FF', EDUCATION: '#F59E0B', FINANCE: '#059669',
  INFRASTRUCTURE: '#0071E3', SECURITY: '#4687FF', HEALTH: '#EF4444', SPORT: '#22C55E',
  DEVELOPER: '#24292E', NEWS: '#1A1A1A', BUSINESS: '#6366F1', OTHER: '#9CA3AF',
};

// Page geometry (A4 portrait)
const PW = 595.28;
const PH = 841.89;
const ML = 50;
const MR = 50;
const MT = 50;
const MB = 60;
const CW = PW - ML - MR;
const CONTENT_BOTTOM = PH - MB;

// ─── Currency formatting ─────────────────────────────────────────────────
function fmtMoney(amount: number, currency: string): string {
  const safe = isFinite(amount) ? amount : 0;
  return `${currency} ${safe.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function fmtMoneyCompact(amount: number, currency: string): string {
  const safe = isFinite(amount) ? amount : 0;
  return `${currency} ${Math.round(safe).toLocaleString('en-US')}`;
}

@Injectable()
export class ReportsService {
  private readonly logger = new Logger(ReportsService.name);

  constructor(
    @InjectRepository(Report) private readonly reportRepo: Repository<Report>,
    @InjectRepository(Subscription) private readonly subRepo: Repository<Subscription>,
    @InjectRepository(PaymentCard) private readonly cardRepo: Repository<PaymentCard>,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    @InjectQueue('reports') private readonly reportQueue: Queue,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly fxService: FxService,
  ) {}

  // ────────────────────────────────────────────────────────────
  // Public API
  // ────────────────────────────────────────────────────────────

  async generate(userId: string, from: string, to: string, type: ReportType, locale?: string): Promise<Report> {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (user && user.plan === 'free') {
      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
      const count = await this.reportRepo.count({ where: { userId, createdAt: Between(monthStart, monthEnd) } });
      if (count >= 1) throw new ForbiddenException('Free plan allows 1 report per month. Upgrade to Pro for unlimited reports.');
    }

    const report = this.reportRepo.create({ userId, from, to, type, status: ReportStatus.PENDING });
    const saved = await this.reportRepo.save(report);
    await this.reportQueue.add('generate-pdf', {
      reportId: saved.id,
      userId,
      locale: locale || user?.locale || 'en',
    });
    return saved;
  }

  async findOne(userId: string, id: string): Promise<Report> {
    const report = await this.reportRepo.findOne({ where: { id } });
    if (!report) throw new NotFoundException('Report not found');
    if (report.userId !== userId) throw new ForbiddenException();
    return report;
  }

  async findAll(userId: string): Promise<Report[]> {
    return this.reportRepo.find({ where: { userId }, order: { createdAt: 'DESC' } });
  }

  async downloadPdf(userId: string, id: string): Promise<Buffer> {
    const report = await this.findOne(userId, id);
    if (report.status !== ReportStatus.READY) throw new NotFoundException(`Report is not ready yet (status: ${report.status})`);
    const base64 = await this.redis.get(`report:pdf:${id}`);
    if (!base64) throw new NotFoundException('PDF expired. Please regenerate.');
    return Buffer.from(base64, 'base64');
  }

  // ────────────────────────────────────────────────────────────
  // Processor entry point
  // ────────────────────────────────────────────────────────────

  async buildAndStorePdf(userId: string, reportId: string, locale = 'en'): Promise<void> {
    await this.reportRepo.update(reportId, { status: ReportStatus.GENERATING, error: null });
    try {
      const buffer = await this.buildPdf(userId, reportId, locale);
      await this.redis.set(`report:pdf:${reportId}`, buffer.toString('base64'), 'EX', PDF_TTL_SECONDS);
      await this.reportRepo.update(reportId, { status: ReportStatus.READY });
      this.logger.log(`PDF ready: report ${reportId}`);
    } catch (error) {
      this.logger.error(`PDF failed: report ${reportId}: ${error.message}`);
      await this.reportRepo.update(reportId, { status: ReportStatus.FAILED, error: error.message?.substring(0, 500) });
      throw error;
    }
  }

  // ────────────────────────────────────────────────────────────
  // PDF Builder
  // ────────────────────────────────────────────────────────────

  private async buildPdf(userId: string, id: string, locale: string): Promise<Buffer> {
    const report = await this.findOne(userId, id);
    const user = await this.userRepo.findOne({ where: { id: userId } });
    const cards = await this.cardRepo.find({ where: { userId } });
    const cardMap = Object.fromEntries(cards.map((c) => [c.id, c]));

    // Subscriptions overlapping the requested period.
    const subsRaw = await this.subRepo.createQueryBuilder('s')
      .where('s.userId = :userId', { userId })
      .andWhere('(s.startDate IS NULL OR s.startDate <= :to)', { to: report.to })
      .andWhere('(s.cancelledAt IS NULL OR s.cancelledAt >= :from)', { from: report.from })
      .orderBy('s.amount', 'DESC')
      .getMany();

    // Pre-fetch icons for top 30 (used in detailed/tax tables).
    const iconMap = new Map<string, Buffer>();
    await Promise.all(subsRaw.filter((s) => s.iconUrl).slice(0, 30).map(async (s) => {
      const buf = await this.fetchIcon(s.iconUrl);
      if (buf) iconMap.set(s.id, buf);
    }));

    // Display currency: prefer user.displayCurrency, then the most-used
    // subscription currency, then USD as last resort.
    const displayCurrency = user?.displayCurrency || this.dominantCurrency(subsRaw) || 'USD';

    // FX conversion — fetch once, attach `monthlyConverted` and
    // `amountConverted` to each sub. Failures fall back to 0 with a logged
    // warning so a broken FX provider can't take down the whole report.
    const fxConverted = await this.attachConverted(subsRaw, displayCurrency);
    const subs = fxConverted.subs;
    const fxFailed = fxConverted.failed;

    // CJK fallback: bundled Roboto does not contain Chinese/Japanese/Korean
    // glyphs, so rendering those locales would produce a PDF full of `.notdef`
    // tofu boxes — strictly worse than the (English-only) status quo. Until
    // Noto Sans CJK is shipped, force-fallback to English copy for those
    // locales while leaving everything else (currency, dates) localized.
    const code = (locale ?? 'en').split(/[-_]/)[0].toLowerCase();
    const cjkLocale = code === 'zh' || code === 'ja' || code === 'ko';
    const i18n = pdfL(cjkLocale ? 'en' : locale);

    return new Promise<Buffer>((resolve, reject) => {
      const doc = new PDFDocument({
        // Use real margins so addPage() resets doc.y to MT and content on
        // pages 2+ doesn't render at y=0 over the top edge.
        margin: 0,
        margins: { top: MT, bottom: MB, left: ML, right: MR },
        size: 'A4',
        autoFirstPage: false,
        bufferPages: true,
      }) as any;
      const buffers: Buffer[] = [];
      doc.on('data', (chunk: Buffer) => buffers.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(buffers)));
      doc.on('error', reject);

      // Register TTF fonts that support Cyrillic etc. (built-in Helvetica is
      // Latin-1 only — was the root cause of the "broken encoding" reports).
      const F = registerReportFonts(doc);

      // Restart layout at the top margin on every new page (table headers
      // and section titles call addPage themselves; without this they'd
      // overlap the page edge).
      doc.on('pageAdded', () => {
        doc.x = ML;
        doc.y = MT;
      });

      doc.addPage();
      this.drawHeader(doc, F, i18n, report, user);

      // ── Meta strip ─────────────────────────────────────────
      doc.fontSize(9).font(F.regular).fillColor(C.textMuted);
      doc.text(`${i18n.period}: ${this.fmtDate(report.from, locale)} — ${this.fmtDate(report.to, locale)}`, ML, doc.y);
      doc.text(`${i18n.generated}: ${this.fmtDate(new Date().toISOString(), locale)}`, ML, doc.y - 11, {
        align: 'right',
        width: CW,
      });
      if (user?.email) doc.text(`${i18n.account}: ${user.email}`, ML);
      if (fxFailed) {
        doc.fillColor(C.orange).text(
          `⚠ ${i18n.fx_partial_failure}`, ML);
        doc.fillColor(C.textMuted);
      }
      doc.moveDown(1);
      doc.fillColor(C.text);

      // ── Content ────────────────────────────────────────────
      if (report.type === ReportType.SUMMARY) {
        this.pdfSummary(doc, F, i18n, subs, displayCurrency, locale);
      } else if (report.type === ReportType.DETAILED) {
        this.pdfDetailed(doc, F, i18n, subs, cardMap, iconMap, displayCurrency, locale);
      } else if (report.type === ReportType.TAX) {
        this.pdfTax(doc, F, i18n, subs, cardMap, iconMap, displayCurrency, locale);
      } else {
        this.pdfSummary(doc, F, i18n, subs, displayCurrency, locale);
      }

      // ── Pagination footer (after all content) ──────────────
      this.drawPaginationFooter(doc, F, i18n);

      doc.end();
    });
  }

  // ════════════════════════════════════════════════════════════
  // Header / footer
  // ════════════════════════════════════════════════════════════

  private drawHeader(doc: any, F: { regular: string; bold: string }, i18n: ReportI18n, report: Report, user: User | null) {
    const reportTitle = (i18n as any)[`${report.type.toLowerCase()}_report`] ?? i18n.summary_report;
    doc.rect(0, 0, PW, 90).fill(C.headerBg);
    // PDFKit fillColor() ignores `rgba(...)` strings — we have to call
    // fillColor with an opacity argument to get translucency. Using hex
    // strings here keeps the visual hierarchy we wanted (faded "AI" suffix,
    // semi-transparent metadata) without falling back to opaque white.
    doc.fontSize(24).font(F.bold).fillColor(C.white).text('SubRadar', ML, 22, { continued: true });
    doc.fontSize(24).fillColor(C.white, 0.5).text(' AI');
    doc.fontSize(12).font(F.regular).fillColor(C.white, 0.9).text(reportTitle, ML, 52);
    if (user) doc.fontSize(9).fillColor(C.white, 0.7).text(user.name || user.email, ML, 70, { align: 'right', width: CW });
    doc.fillColor(C.text);
    doc.fillOpacity(1);
    doc.y = 105;
  }

  /**
   * Draw "Page X of Y" + footer text in the bottom margin of every buffered
   * page. Must be called AFTER all content is laid out — that's when
   * `bufferedPageRange()` knows the final page count.
   */
  private drawPaginationFooter(doc: any, F: { regular: string; bold: string }, i18n: ReportI18n) {
    const range = doc.bufferedPageRange();
    const total = range.count;
    for (let i = 0; i < total; i++) {
      doc.switchToPage(range.start + i);
      // Restore `text` calls without consuming page-flow state.
      doc.fontSize(8).font(F.regular).fillColor(C.textMuted);
      const pageLabel = i18n.page_of(i + 1, total);
      doc.text(pageLabel, ML, PH - 30, {
        width: CW / 2,
        align: 'left',
        lineBreak: false,
      });
      doc.text(i18n.footer, ML + CW / 2, PH - 30, {
        width: CW / 2,
        align: 'right',
        lineBreak: false,
      });
    }
    doc.flushPages();
  }

  // ════════════════════════════════════════════════════════════
  // SUMMARY
  // ════════════════════════════════════════════════════════════

  private pdfSummary(
    doc: any,
    F: { regular: string; bold: string },
    i18n: ReportI18n,
    subs: SubWithMoney[],
    cur: string,
    locale: string,
  ) {
    const active = subs.filter((s) => s.status === 'ACTIVE' || s.status === 'TRIAL');
    const totalMonthly = subs.reduce((s, sub) => s + sub.monthlyConverted, 0);
    const yearly = totalMonthly * 12;

    // ── Overview hero box ─────────────────
    const boxTop = doc.y;
    doc.rect(ML, boxTop, CW, 70).lineWidth(1).strokeColor(C.border).fillAndStroke(C.rowEven, C.border);
    doc.fontSize(11).font(F.bold).fillColor(C.text).text(i18n.overview, ML + 14, boxTop + 8);
    doc.fontSize(24).font(F.bold).fillColor(C.primary).text(fmtMoney(totalMonthly, cur), ML + 14, boxTop + 22);
    doc.fontSize(10).font(F.regular).fillColor(C.textLight).text(i18n.per_month, ML + 14, boxTop + 52);
    doc.fontSize(10).fillColor(C.textMuted).text(
      `${active.length} ${i18n.active_subs}  |  ${fmtMoneyCompact(yearly, cur)} ${i18n.per_year}`,
      ML + 14, boxTop + 52, { align: 'right', width: CW - 28 },
    );
    doc.y = boxTop + 80;

    // ── Insights ──────────────────────────
    if (subs.length > 0) {
      this.drawInsights(doc, F, i18n, subs, cur);
    }

    // ── Spending chart by category ────────
    const byCat: Record<string, { count: number; amount: number }> = {};
    subs.forEach((s) => {
      if (!byCat[s.category]) byCat[s.category] = { count: 0, amount: 0 };
      byCat[s.category].count++;
      byCat[s.category].amount += s.monthlyConverted;
    });
    const catSorted = Object.entries(byCat).sort((a, b) => b[1].amount - a[1].amount);
    const maxAmt = catSorted[0]?.[1].amount || 1;

    if (catSorted.length > 0) {
      this.sectionTitle(doc, F, i18n.spending_chart);
      const chartTop = doc.y;
      const barH = 18;
      const barGap = 6;
      const labelW = 130;
      const barMaxW = CW - labelW - 100;

      catSorted.slice(0, 8).forEach(([cat, data], i) => {
        const y = chartTop + i * (barH + barGap);
        if (this.needsPage(doc, y + barH)) { doc.addPage(); }
        const barW = Math.max(4, (data.amount / maxAmt) * barMaxW);
        const color = CATEGORY_COLORS[cat] || C.textMuted;
        const pct = totalMonthly > 0 ? (data.amount / totalMonthly) * 100 : 0;
        doc.fontSize(9).font(F.regular).fillColor(C.text).text(this.localizeCategory(cat, i18n), ML, y + 3, { width: labelW - 4 });
        doc.rect(ML + labelW, y, barW, barH).fill(color);
        doc.fontSize(9).fillColor(C.textLight).text(
          `${fmtMoneyCompact(data.amount, cur)}  (${pct.toFixed(0)}%)`,
          ML + labelW + barW + 6, y + 3,
        );
      });
      doc.y = chartTop + Math.min(catSorted.length, 8) * (barH + barGap) + 10;
    }

    // ── Top subscriptions table ───────────
    if (subs.length > 0) {
      this.sectionTitle(doc, F, i18n.top_subs);
      const cols = [
        { label: '#', w: 25 },
        { label: i18n.name, w: 200 },
        { label: i18n.category, w: 140 },
        { label: `${i18n.amount} ${i18n.monthly}`, w: CW - 25 - 200 - 140 },
      ];
      this.tableHeader(doc, F, cols);
      subs.slice(0, 10).forEach((s, i) => {
        if (this.needsPage(doc, doc.y + 18)) { doc.addPage(); this.tableHeader(doc, F, cols); }
        this.tableRow(doc, F, [
          `${i + 1}`,
          s.name,
          this.localizeCategory(s.category, i18n),
          fmtMoney(s.monthlyConverted, cur),
        ], cols, i);
      });
    }

    // ── Status breakdown ──────────────────
    doc.moveDown(1);
    this.sectionTitle(doc, F, i18n.by_status);
    const byStatus: Record<string, number> = {};
    subs.forEach((s) => { byStatus[s.status] = (byStatus[s.status] || 0) + 1; });
    const totalCount = subs.length || 1;
    doc.fontSize(10).font(F.regular);
    Object.entries(byStatus).forEach(([status, count]) => {
      const color = status === 'ACTIVE' ? C.green : status === 'TRIAL' ? C.orange : status === 'CANCELLED' ? C.red : C.textMuted;
      // Reserve room for this status row BEFORE drawing — earlier code did
      // `addPage(); return;` which silently dropped the row entirely.
      if (this.needsPage(doc, doc.y + 14)) doc.addPage();
      const y = doc.y;
      doc.circle(ML + 4, y + 5, 3).fill(color);
      const pct = ((count / totalCount) * 100).toFixed(0);
      doc.fillColor(C.text).text(
        `  ${this.localizeStatus(status, i18n)}: ${count} (${pct}%)`,
        ML + 10, y,
      );
    });
  }

  private drawInsights(
    doc: any,
    F: { regular: string; bold: string },
    i18n: ReportI18n,
    subs: SubWithMoney[],
    cur: string,
  ) {
    const totalMonthly = subs.reduce((s, sub) => s + sub.monthlyConverted, 0);
    const byCat: Record<string, number> = {};
    subs.forEach((s) => { byCat[s.category] = (byCat[s.category] || 0) + s.monthlyConverted; });
    const topCat = Object.entries(byCat).sort((a, b) => b[1] - a[1])[0];
    const avg = subs.length ? totalMonthly / subs.length : 0;
    const yearly = totalMonthly * 12;
    const largest = [...subs].sort((a, b) => b.monthlyConverted - a.monthlyConverted)[0];

    this.sectionTitle(doc, F, i18n.insights);
    const startY = doc.y;
    const boxH = 92;
    if (this.needsPage(doc, startY + boxH)) { doc.addPage(); }
    const y = doc.y;
    doc.rect(ML, y, CW, boxH).fill(C.insightBg);

    doc.fontSize(10).font(F.regular).fillColor(C.text);
    let row = y + 10;
    const lh = 18;

    if (topCat) {
      doc.text(
        `▸ ${i18n.insight_top_category(this.localizeCategory(topCat[0], i18n), fmtMoneyCompact(topCat[1], cur))}`,
        ML + 14, row, { width: CW - 28 },
      );
      row += lh;
    }
    if (largest) {
      doc.text(
        `▸ ${i18n.insight_largest(largest.name, fmtMoney(largest.monthlyConverted, cur))}`,
        ML + 14, row, { width: CW - 28 },
      );
      row += lh;
    }
    doc.text(
      `▸ ${i18n.insight_avg_payment(fmtMoney(avg, cur))}`,
      ML + 14, row, { width: CW - 28 },
    );
    row += lh;
    doc.text(
      `▸ ${i18n.insight_yearly_forecast(fmtMoneyCompact(yearly, cur))}`,
      ML + 14, row, { width: CW - 28 },
    );

    doc.y = y + boxH + 10;
  }

  // ════════════════════════════════════════════════════════════
  // DETAILED
  // ════════════════════════════════════════════════════════════

  private pdfDetailed(
    doc: any,
    F: { regular: string; bold: string },
    i18n: ReportI18n,
    subs: SubWithMoney[],
    cardMap: Record<string, PaymentCard>,
    iconMap: Map<string, Buffer>,
    cur: string,
    locale: string,
  ) {
    const totalMonthly = subs.reduce((s, sub) => s + sub.monthlyConverted, 0);

    this.sectionTitle(
      doc,
      F,
      `${i18n.subscriptions} (${subs.length})  —  ${i18n.total}: ${fmtMoney(totalMonthly, cur)}${i18n.monthly}`,
    );

    const cols = [
      { label: '', w: 22 }, // icon
      { label: i18n.name, w: 130 },
      { label: i18n.amount, w: 90 },
      { label: i18n.category, w: 90 },
      { label: i18n.status, w: 60 },
      { label: i18n.card, w: 60 },
      { label: i18n.next_payment, w: CW - 22 - 130 - 90 - 90 - 60 - 60 },
    ];
    this.tableHeader(doc, F, cols);

    subs.forEach((s, i) => {
      if (this.needsPage(doc, doc.y + 22)) {
        doc.addPage();
        this.tableHeader(doc, F, cols);
      }
      const card = s.paymentCardId ? cardMap[s.paymentCardId] : null;
      const rowY = doc.y;
      // Background for even rows
      if (i % 2 === 0) doc.rect(ML, rowY, CW, 22).fill(C.rowEven);

      // Icon column
      const icon = iconMap.get(s.id);
      if (icon) {
        try {
          doc.image(icon, ML + 4, rowY + 3, { width: 16, height: 16 });
        } catch {
          // Bad image bytes — skip silently, the row is still readable.
        }
      }

      // Other columns
      doc.fontSize(9).font(F.regular).fillColor(C.text);
      let x = ML + 22;
      const values = [
        s.name,
        `${fmtMoney(s.amountConverted, cur)}${this.periodLabel(s.billingPeriod, i18n)}`,
        this.localizeCategory(s.category, i18n),
        this.localizeStatus(s.status, i18n),
        card ? `••••${card.last4}` : '—',
        s.nextPaymentDate ? this.fmtDate(s.nextPaymentDate, locale) : '—',
      ];
      cols.slice(1).forEach((col, j) => {
        doc.text(values[j], x + 6, rowY + 6, { width: col.w - 12, lineBreak: false, ellipsis: true });
        x += col.w;
      });
      doc.y = rowY + 22;
    });

    // Total row
    const totalY = doc.y;
    if (this.needsPage(doc, totalY + 24)) doc.addPage();
    doc.rect(ML, doc.y, CW, 24).fill(C.primary);
    doc.fontSize(11).font(F.bold).fillColor(C.white);
    doc.text(i18n.total, ML + 6, doc.y - 18, { width: 130, lineBreak: false });
    doc.text(
      `${fmtMoney(totalMonthly, cur)}${i18n.monthly}`,
      ML + CW - 200, doc.y - 14, { width: 190, align: 'right', lineBreak: false },
    );
    doc.y = doc.y + 10;
    doc.fillColor(C.text);
  }

  // ════════════════════════════════════════════════════════════
  // TAX
  // ════════════════════════════════════════════════════════════

  private pdfTax(
    doc: any,
    F: { regular: string; bold: string },
    i18n: ReportI18n,
    subs: SubWithMoney[],
    cardMap: Record<string, PaymentCard>,
    iconMap: Map<string, Buffer>,
    cur: string,
    locale: string,
  ) {
    const business = subs.filter((s) => s.isBusinessExpense);
    const personal = subs.filter((s) => !s.isBusinessExpense);
    // FIX: previously used raw `Number(sub.amount)` which over-counted yearly
    // subscriptions ($99/yr surfacing as $99 instead of $8.25/mo). Use the
    // already-normalized `monthlyConverted` so totals match the rest of the
    // report and reflect real monthly cash flow.
    const bizMonthly = business.reduce((s, sub) => s + sub.monthlyConverted, 0);
    const persMonthly = personal.reduce((s, sub) => s + sub.monthlyConverted, 0);
    const bizYearly = bizMonthly * 12;
    const persYearly = persMonthly * 12;

    // ── Tax summary box ──────────────────
    this.sectionTitle(doc, F, i18n.tax_summary);
    const boxTop = doc.y;
    doc.rect(ML, boxTop, CW, 78).fillAndStroke(C.rowEven, C.border);

    // Business (deductible)
    doc.fontSize(10).font(F.regular).fillColor(C.textLight).text(`${i18n.business_expenses} (${business.length})`, ML + 14, boxTop + 12);
    doc.fontSize(18).font(F.bold).fillColor(C.green).text(fmtMoney(bizMonthly, cur), ML + 14, boxTop + 24);
    doc.fontSize(9).font(F.regular).fillColor(C.textMuted).text(`${i18n.monthly} · ${fmtMoneyCompact(bizYearly, cur)} ${i18n.yearly}`, ML + 14, boxTop + 50);

    // Personal
    doc.fontSize(10).font(F.regular).fillColor(C.textLight).text(`${i18n.personal_expenses} (${personal.length})`, ML + CW / 2, boxTop + 12);
    doc.fontSize(18).font(F.bold).fillColor(C.text).text(fmtMoney(persMonthly, cur), ML + CW / 2, boxTop + 24);
    doc.fontSize(9).font(F.regular).fillColor(C.textMuted).text(`${i18n.monthly} · ${fmtMoneyCompact(persYearly, cur)} ${i18n.yearly}`, ML + CW / 2, boxTop + 50);

    doc.y = boxTop + 90;
    doc.fillColor(C.text);

    // ── Per-category breakdown for business ──
    if (business.length > 0) {
      const byCat: Record<string, { count: number; amount: number }> = {};
      business.forEach((s) => {
        if (!byCat[s.category]) byCat[s.category] = { count: 0, amount: 0 };
        byCat[s.category].count++;
        byCat[s.category].amount += s.monthlyConverted;
      });
      const catRows = Object.entries(byCat).sort((a, b) => b[1].amount - a[1].amount);

      this.sectionTitle(doc, F, i18n.by_category_breakdown);
      const cols = [
        { label: i18n.category, w: 200 },
        { label: i18n.subscriptions, w: 120 },
        { label: `${i18n.amount} ${i18n.monthly}`, w: CW - 320 },
      ];
      this.tableHeader(doc, F, cols);
      catRows.forEach(([cat, data], i) => {
        if (this.needsPage(doc, doc.y + 18)) { doc.addPage(); this.tableHeader(doc, F, cols); }
        this.tableRow(doc, F, [
          this.localizeCategory(cat, i18n),
          `${data.count}`,
          fmtMoney(data.amount, cur),
        ], cols, i);
      });
      doc.moveDown(0.5);
    }

    // ── Business detail table ──────────────
    if (business.length > 0) {
      this.sectionTitle(doc, F, i18n.business_expenses);
      const cols = [
        { label: '', w: 22 }, // icon
        { label: i18n.service, w: 150 },
        { label: i18n.category, w: 100 },
        { label: i18n.amount, w: 100 },
        { label: i18n.period_col, w: 70 },
        { label: i18n.card, w: CW - 22 - 150 - 100 - 100 - 70 },
      ];
      this.tableHeader(doc, F, cols);
      business.forEach((s, i) => {
        if (this.needsPage(doc, doc.y + 22)) { doc.addPage(); this.tableHeader(doc, F, cols); }
        const card = s.paymentCardId ? cardMap[s.paymentCardId] : null;
        const rowY = doc.y;
        if (i % 2 === 0) doc.rect(ML, rowY, CW, 22).fill(C.rowEven);
        const icon = iconMap.get(s.id);
        if (icon) {
          try { doc.image(icon, ML + 4, rowY + 3, { width: 16, height: 16 }); } catch {}
        }
        doc.fontSize(9).font(F.regular).fillColor(C.text);
        let x = ML + 22;
        const values = [
          s.name,
          this.localizeCategory(s.category, i18n),
          fmtMoney(s.amountConverted, cur),
          this.periodLabelFull(s.billingPeriod, i18n),
          card ? `••••${card.last4}` : '—',
        ];
        cols.slice(1).forEach((col, j) => {
          doc.text(values[j], x + 6, rowY + 6, { width: col.w - 12, lineBreak: false, ellipsis: true });
          x += col.w;
        });
        doc.y = rowY + 22;
      });

      // Total deductible row
      if (this.needsPage(doc, doc.y + 24)) doc.addPage();
      doc.rect(ML, doc.y, CW, 24).fill(C.green);
      doc.fontSize(11).font(F.bold).fillColor(C.white).text(
        `${i18n.total_deductible}: ${fmtMoney(bizMonthly, cur)}${i18n.monthly}  ·  ${fmtMoneyCompact(bizYearly, cur)} ${i18n.yearly}`,
        ML + 6, doc.y - 18, { width: CW - 12 },
      );
      doc.y = doc.y + 10;
      doc.fillColor(C.text);
    }

    // ── Personal table (same shape as business) ──
    if (personal.length > 0) {
      doc.moveDown(0.5);
      this.sectionTitle(doc, F, i18n.personal_expenses);
      const cols = [
        { label: '', w: 22 },
        { label: i18n.service, w: 150 },
        { label: i18n.category, w: 100 },
        { label: i18n.amount, w: 100 },
        { label: i18n.period_col, w: 70 },
        { label: i18n.card, w: CW - 22 - 150 - 100 - 100 - 70 },
      ];
      this.tableHeader(doc, F, cols);
      personal.forEach((s, i) => {
        if (this.needsPage(doc, doc.y + 22)) { doc.addPage(); this.tableHeader(doc, F, cols); }
        const card = s.paymentCardId ? cardMap[s.paymentCardId] : null;
        const rowY = doc.y;
        if (i % 2 === 0) doc.rect(ML, rowY, CW, 22).fill(C.rowEven);
        const icon = iconMap.get(s.id);
        if (icon) {
          try { doc.image(icon, ML + 4, rowY + 3, { width: 16, height: 16 }); } catch {}
        }
        doc.fontSize(9).font(F.regular).fillColor(C.text);
        let x = ML + 22;
        const values = [
          s.name,
          this.localizeCategory(s.category, i18n),
          fmtMoney(s.amountConverted, cur),
          this.periodLabelFull(s.billingPeriod, i18n),
          card ? `••••${card.last4}` : '—',
        ];
        cols.slice(1).forEach((col, j) => {
          doc.text(values[j], x + 6, rowY + 6, { width: col.w - 12, lineBreak: false, ellipsis: true });
          x += col.w;
        });
        doc.y = rowY + 22;
      });
    }
  }

  // ════════════════════════════════════════════════════════════
  // Drawing helpers
  // ════════════════════════════════════════════════════════════

  private sectionTitle(doc: any, F: { regular: string; bold: string }, title: string) {
    if (this.needsPage(doc, doc.y + 24)) doc.addPage();
    doc.moveDown(0.5);
    doc.fontSize(13).font(F.bold).fillColor(C.text).text(title, ML);
    doc.moveDown(0.4);
  }

  private tableHeader(doc: any, F: { regular: string; bold: string }, cols: { label: string; w: number }[]) {
    const y = doc.y;
    doc.rect(ML, y, cols.reduce((s, c) => s + c.w, 0), 20).fill('#EEEEF5');
    doc.fontSize(8).font(F.bold).fillColor(C.textLight);
    let x = ML;
    cols.forEach((col) => {
      doc.text(col.label.toUpperCase(), x + 6, y + 6, { width: col.w - 12, lineBreak: false });
      x += col.w;
    });
    doc.y = y + 22;
  }

  private tableRow(
    doc: any,
    F: { regular: string; bold: string },
    values: string[],
    cols: { label: string; w: number }[],
    idx: number,
  ) {
    const y = doc.y;
    const totalW = cols.reduce((s, c) => s + c.w, 0);
    if (idx % 2 === 0) doc.rect(ML, y, totalW, 18).fill(C.rowEven);
    doc.fontSize(9).font(F.regular).fillColor(C.text);
    let x = ML;
    values.forEach((val, i) => {
      doc.text(val, x + 6, y + 4, { width: cols[i].w - 12, lineBreak: false, ellipsis: true });
      x += cols[i].w;
    });
    doc.y = y + 18;
  }

  /**
   * Reserve at least `MB + 30` (page footer + a safety margin) under the
   * cursor before drawing. Call before each row / chart bar so we never
   * spill into the pagination footer.
   */
  private needsPage(doc: any, projectedY: number): boolean {
    return projectedY > CONTENT_BOTTOM - 20;
  }

  // ════════════════════════════════════════════════════════════
  // Localization helpers (categories / statuses / periods)
  // ════════════════════════════════════════════════════════════

  private localizeCategory(cat: string, i18n: ReportI18n): string {
    const key = `category_${cat.toLowerCase()}` as keyof ReportI18n;
    const value = i18n[key];
    return typeof value === 'string' && value ? value : cat;
  }

  private localizeStatus(status: string, i18n: ReportI18n): string {
    const key = `status_${status.toLowerCase()}` as keyof ReportI18n;
    const value = i18n[key];
    return typeof value === 'string' && value ? value : status;
  }

  /** Compact period suffix (e.g. "/mo", "/мес"). */
  private periodLabel(p: string, i18n: ReportI18n): string {
    const map: Record<string, keyof ReportI18n> = {
      MONTHLY: 'monthly', YEARLY: 'yearly', WEEKLY: 'weekly',
      QUARTERLY: 'quarterly', LIFETIME: 'lifetime', ONE_TIME: 'one_time',
    };
    const key = map[p];
    if (!key) return '';
    const v = i18n[key];
    return typeof v === 'string' ? v : '';
  }

  /** Full period word (used in tax tables instead of suffix). */
  private periodLabelFull(p: string, i18n: ReportI18n): string {
    const stripped = this.periodLabel(p, i18n).replace(/^\//, '');
    return stripped || p;
  }

  // ════════════════════════════════════════════════════════════
  // Money helpers
  // ════════════════════════════════════════════════════════════

  /**
   * Most-frequent currency across the user's subscriptions. Used when the
   * user has no explicit `displayCurrency` (legacy accounts). Falls back
   * to the first sub's currency if frequencies tie.
   */
  private dominantCurrency(subs: Subscription[]): string | null {
    if (subs.length === 0) return null;
    const counts: Record<string, number> = {};
    subs.forEach((s) => { counts[s.currency] = (counts[s.currency] || 0) + 1; });
    return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
  }

  /**
   * Convert each subscription's `amount` to `targetCurrency` and compute its
   * monthly equivalent (yearly → /12, weekly → ×4.33, etc.). Returns the
   * decorated array plus a `failed` flag so the report can surface "FX
   * partial failure" warning if a currency couldn't be priced.
   */
  private async attachConverted(
    subs: Subscription[],
    targetCurrency: string,
  ): Promise<{ subs: SubWithMoney[]; failed: boolean }> {
    if (subs.length === 0) return { subs: [], failed: false };

    let rates: Record<string, number> = {};
    let fxFailed = false;
    try {
      const fx = await this.fxService.getRates();
      rates = fx.rates;
    } catch (e) {
      this.logger.warn(`FX fetch failed in PDF: ${(e as Error).message}`);
      fxFailed = true;
    }

    const decorated: SubWithMoney[] = subs.map((s) => {
      const raw = new Decimal(s.amount || 0);
      let amountConverted = 0;
      try {
        if (Object.keys(rates).length === 0) {
          amountConverted = s.currency === targetCurrency ? raw.toNumber() : 0;
        } else {
          amountConverted = this.fxService
            .convert(raw, s.currency, targetCurrency, rates)
            .toNumber();
        }
      } catch (e) {
        this.logger.debug(`FX convert failed ${s.currency}→${targetCurrency}: ${(e as Error).message}`);
        amountConverted = s.currency === targetCurrency ? raw.toNumber() : 0;
        fxFailed = true;
      }
      const monthlyConverted = this.toMonthly(amountConverted, s.billingPeriod);
      return Object.assign(s, { amountConverted, monthlyConverted });
    });

    return { subs: decorated, failed: fxFailed };
  }

  private toMonthly(amount: number, billingPeriod: string): number {
    switch (billingPeriod) {
      case 'YEARLY': return amount / 12;
      case 'QUARTERLY': return amount / 3;
      case 'WEEKLY': return amount * 4.33;
      case 'LIFETIME':
      case 'ONE_TIME':
        return 0; // Not a recurring charge — exclude from monthly totals
      default: return amount; // MONTHLY (and unknown)
    }
  }

  // ════════════════════════════════════════════════════════════
  // Misc utilities
  // ════════════════════════════════════════════════════════════

  private async fetchIcon(url: string): Promise<Buffer | null> {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
      if (!res.ok) return null;
      const ct = res.headers.get('content-type') || '';
      if (!ct.startsWith('image/')) return null;
      // PDFKit accepts JPEG/PNG bytes directly. SVG would need rasterization
      // which we skip to keep the dependency surface small.
      if (!ct.includes('jpeg') && !ct.includes('jpg') && !ct.includes('png')) return null;
      return Buffer.from(await res.arrayBuffer());
    } catch { return null; }
  }

  private fmtDate(d?: string | Date | null, locale = 'en'): string {
    if (!d) return '—';
    const date = new Date(d);
    if (isNaN(date.getTime())) return '—';
    const code = (locale ?? 'en').split(/[-_]/)[0].toLowerCase();
    const intlMap: Record<string, string> = {
      ru: 'ru-RU', kk: 'kk-KZ', es: 'es-ES', de: 'de-DE',
      fr: 'fr-FR', pt: 'pt-BR', zh: 'zh-CN', ja: 'ja-JP', ko: 'ko-KR',
    };
    const loc = intlMap[code] ?? 'en-US';
    return date.toLocaleDateString(loc, { year: 'numeric', month: 'short', day: 'numeric' });
  }
}

// Subscription decorated with currency-converted amounts. Kept inline because
// it's a private contract between buildPdf and its draw helpers — exporting
// would invite leaks into other modules where the raw entity should be used.
type SubWithMoney = Subscription & {
  amountConverted: number;
  monthlyConverted: number;
};
