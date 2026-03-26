import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bull';
import type { Queue } from 'bull';
import { Repository, Between } from 'typeorm';
import Redis from 'ioredis';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const PDFDocument = require('pdfkit');
import { Report, ReportType, ReportStatus } from './entities/report.entity';
import { Subscription } from '../subscriptions/entities/subscription.entity';
import { PaymentCard } from '../payment-cards/entities/payment-card.entity';
import { User } from '../users/entities/user.entity';

/** TTL for stored PDF buffers in Redis (1 hour) */
const PDF_TTL_SECONDS = 3600;

@Injectable()
export class ReportsService {
  private readonly logger = new Logger(ReportsService.name);
  private readonly redis: Redis;

  constructor(
    @InjectRepository(Report) private readonly reportRepo: Repository<Report>,
    @InjectRepository(Subscription)
    private readonly subRepo: Repository<Subscription>,
    @InjectRepository(PaymentCard)
    private readonly cardRepo: Repository<PaymentCard>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectQueue('reports') private readonly reportQueue: Queue,
    private readonly cfg: ConfigService,
  ) {
    this.redis = new Redis(
      cfg.get<string>('REDIS_URL') || 'redis://localhost:6379',
    );
  }

  // ────────────────────────────────────────────────────────────
  // Public API
  // ────────────────────────────────────────────────────────────

  /**
   * Create a report record with status=PENDING and enqueue PDF generation.
   * Returns immediately — the caller polls GET /reports/:id for status.
   */
  async generate(
    userId: string,
    from: string,
    to: string,
    type: ReportType,
  ): Promise<Report> {
    // Enforce monthly report limit for free users
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (user && user.plan === 'free') {
      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const monthEnd = new Date(
        now.getFullYear(),
        now.getMonth() + 1,
        0,
        23,
        59,
        59,
        999,
      );

      const reportsThisMonth = await this.reportRepo.count({
        where: {
          userId,
          createdAt: Between(monthStart, monthEnd),
        },
      });

      if (reportsThisMonth >= 1) {
        throw new ForbiddenException(
          'Free plan allows 1 report per month. Upgrade to Pro for unlimited reports.',
        );
      }
    }

    const report = this.reportRepo.create({
      userId,
      from,
      to,
      type,
      status: ReportStatus.PENDING,
    });
    const saved = await this.reportRepo.save(report);

    // Enqueue async PDF generation
    await this.reportQueue.add('generate-pdf', {
      reportId: saved.id,
      userId,
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
    return this.reportRepo.find({
      where: { userId },
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * Read generated PDF buffer from Redis.
   * Throws 404 if the report is not READY yet.
   */
  async downloadPdf(userId: string, id: string): Promise<Buffer> {
    const report = await this.findOne(userId, id);

    if (report.status !== ReportStatus.READY) {
      throw new NotFoundException(
        `Report is not ready yet (status: ${report.status})`,
      );
    }

    const key = `report:pdf:${id}`;
    const base64 = await this.redis.get(key);
    if (!base64) {
      throw new NotFoundException(
        'PDF expired or not found. Please regenerate the report.',
      );
    }

    return Buffer.from(base64, 'base64');
  }

  // ────────────────────────────────────────────────────────────
  // Called by ReportsProcessor — builds PDF, stores in Redis
  // ────────────────────────────────────────────────────────────

  async buildAndStorePdf(userId: string, reportId: string): Promise<void> {
    // Mark GENERATING
    await this.reportRepo.update(reportId, {
      status: ReportStatus.GENERATING,
      error: null,
    });

    try {
      const buffer = await this.buildPdf(userId, reportId);

      // Store PDF in Redis with TTL
      const key = `report:pdf:${reportId}`;
      await this.redis.set(key, buffer.toString('base64'), 'EX', PDF_TTL_SECONDS);

      // Mark READY
      await this.reportRepo.update(reportId, {
        status: ReportStatus.READY,
      });

      this.logger.log(`PDF stored for report ${reportId} (TTL ${PDF_TTL_SECONDS}s)`);
    } catch (error) {
      this.logger.error(
        `PDF generation failed for report ${reportId}: ${error.message}`,
      );
      await this.reportRepo.update(reportId, {
        status: ReportStatus.FAILED,
        error: error.message?.substring(0, 500) || 'Unknown error',
      });
      throw error;
    }
  }

  // ────────────────────────────────────────────────────────────
  // Internal PDF builder (extracted from old generatePdf)
  // ────────────────────────────────────────────────────────────

  private async buildPdf(userId: string, id: string): Promise<Buffer> {
    const report = await this.findOne(userId, id);
    const user = await this.userRepo.findOne({ where: { id: userId } });
    const cards = await this.cardRepo.find({ where: { userId } });
    const cardMap = Object.fromEntries(cards.map((c) => [c.id, c]));

    const subs = await this.subRepo
      .createQueryBuilder('s')
      .where('s.userId = :userId', { userId })
      .andWhere('(s.startDate IS NULL OR s.startDate <= :to)', {
        to: report.to,
      })
      .andWhere('(s.cancelledAt IS NULL OR s.cancelledAt >= :from)', {
        from: report.from,
      })
      .orderBy('s.amount', 'DESC')
      .getMany();

    // Pre-fetch icons
    const iconMap = new Map<string, Buffer>();
    const iconPromises = subs
      .filter((s) => s.iconUrl)
      .slice(0, 30)
      .map(async (s) => {
        const buf = await this.fetchIcon(s.iconUrl);
        if (buf) iconMap.set(s.id, buf);
      });
    await Promise.all(iconPromises);

    try {
      return await new Promise<Buffer>((resolve, reject) => {
        const doc = new PDFDocument({ margin: 50, size: 'A4' }) as any;
        const buffers: Buffer[] = [];
        doc.on('data', (chunk) => buffers.push(chunk));
        doc.on('end', () => resolve(Buffer.concat(buffers)));
        doc.on('error', reject);

        const pageW = 595.28;
        const marginL = 50;
        const marginR = 50;
        const contentW = pageW - marginL - marginR;

        // ── Header ──────────────────────────────────────────────
        doc.rect(0, 0, pageW, 100).fill('#6C47FF');
        doc
          .fontSize(22)
          .font('Helvetica-Bold')
          .fillColor('#FFFFFF')
          .text('SubRadar', marginL, 28, { continued: true })
          .fontSize(22)
          .fillColor('rgba(255,255,255,0.6)')
          .text(' AI');
        doc
          .fontSize(11)
          .fillColor('rgba(255,255,255,0.85)')
          .text(`${report.type.toUpperCase()} REPORT`, marginL, 58);

        // User info — right side
        if (user) {
          doc
            .fontSize(10)
            .fillColor('rgba(255,255,255,0.9)')
            .text(user.name || user.email, marginL, 75, {
              align: 'right',
              width: contentW,
            });
        }

        doc.fillColor('#000000');
        doc.y = 115;

        // ── Meta info ──────────────────────────────────────────
        doc
          .fontSize(9)
          .fillColor('#888888')
          .text(
            `Period: ${this.formatDate(report.from)} — ${this.formatDate(report.to)}`,
            marginL,
            doc.y,
          );
        doc.text(
          `Generated: ${this.formatDate(new Date().toISOString())}`,
          marginL,
          doc.y,
          { align: 'right', width: contentW },
        );
        if (user?.email) {
          doc.text(`Account: ${user.email}`, marginL);
        }
        doc.moveDown(1.5);
        doc.fillColor('#000000');

        // ── Divider ─────────────────────────────────────────────
        const drawDivider = () => {
          const y = doc.y;
          doc
            .moveTo(marginL, y)
            .lineTo(pageW - marginR, y)
            .lineWidth(0.5)
            .strokeColor('#E0E0E0')
            .stroke();
          doc.moveDown(0.5);
        };

        if (report.type === ReportType.SUMMARY) {
          this.addSummaryContent(doc, subs, marginL, contentW, drawDivider);
        } else if (report.type === ReportType.DETAILED) {
          this.addDetailedContent(
            doc,
            subs,
            cardMap,
            iconMap,
            marginL,
            contentW,
            drawDivider,
          );
        } else if (report.type === ReportType.TAX) {
          this.addTaxContent(doc, subs, cardMap, marginL, contentW, drawDivider);
        }

        // ── Footer ──────────────────────────────────────────────
        doc.moveDown(2);
        drawDivider();
        doc
          .fontSize(8)
          .fillColor('#AAAAAA')
          .text(
            'Generated by SubRadar AI — app.subradar.ai',
            marginL,
            doc.y,
            { align: 'center', width: contentW },
          );

        doc.end();
      });
    } catch (error) {
      throw new InternalServerErrorException('Failed to generate PDF report');
    }
  }

  // ────────────────────────────────────────────────────────────
  // Private helpers (unchanged)
  // ────────────────────────────────────────────────────────────

  private async fetchIcon(url: string): Promise<Buffer | null> {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
      if (!res.ok) return null;
      const ct = res.headers.get('content-type') || '';
      if (!ct.startsWith('image/')) return null;
      return Buffer.from(await res.arrayBuffer());
    } catch {
      return null;
    }
  }

  private getMonthlyAmount(sub: Subscription): number {
    const amt = Number(sub.amount) || 0;
    switch (sub.billingPeriod) {
      case 'YEARLY':
        return amt / 12;
      case 'QUARTERLY':
        return amt / 3;
      case 'WEEKLY':
        return amt * 4.33;
      default:
        return amt;
    }
  }

  private formatDate(d?: string | Date | null): string {
    if (!d) return '\u2014';
    const date = new Date(d);
    if (isNaN(date.getTime())) return '\u2014';
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  }

  private periodLabel(p: string): string {
    const map: Record<string, string> = {
      MONTHLY: '/mo',
      YEARLY: '/yr',
      WEEKLY: '/wk',
      QUARTERLY: '/qtr',
      LIFETIME: 'lifetime',
      ONE_TIME: 'one-time',
    };
    return map[p] || p;
  }

  private addSummaryContent(
    doc: any,
    subs: Subscription[],
    marginL: number,
    contentW: number,
    drawDivider: () => void,
  ) {
    const total = subs.reduce((sum, s) => sum + Number(s.amount), 0);
    const totalMonthly = subs.reduce(
      (sum, s) => sum + this.getMonthlyAmount(s),
      0,
    );
    const activeSubs = subs.filter(
      (s) => s.status === 'ACTIVE' || s.status === 'TRIAL',
    );
    const currency = subs[0]?.currency || 'USD';

    // Summary cards
    doc
      .fontSize(16)
      .font('Helvetica-Bold')
      .fillColor('#1A1A1A')
      .text('Overview');
    doc.moveDown(0.5);

    doc.fontSize(12).font('Helvetica');
    doc
      .fillColor('#6C47FF')
      .text(`${activeSubs.length}`, marginL, doc.y, { continued: true })
      .fillColor('#333333')
      .text(` active subscriptions`);
    doc
      .fillColor('#6C47FF')
      .text(`${currency} ${totalMonthly.toFixed(2)}`, marginL, doc.y, {
        continued: true,
      })
      .fillColor('#333333')
      .text(` / month`);
    doc
      .fillColor('#6C47FF')
      .text(
        `${currency} ${(totalMonthly * 12).toFixed(2)}`,
        marginL,
        doc.y,
        { continued: true },
      )
      .fillColor('#333333')
      .text(` / year (estimated)`);
    doc.moveDown(1);

    drawDivider();

    // By category
    doc
      .fontSize(14)
      .font('Helvetica-Bold')
      .fillColor('#1A1A1A')
      .text('By Category');
    doc.moveDown(0.5);
    const byCat: Record<string, { count: number; amount: number }> = {};
    subs.forEach((s) => {
      if (!byCat[s.category]) byCat[s.category] = { count: 0, amount: 0 };
      byCat[s.category].count++;
      byCat[s.category].amount += this.getMonthlyAmount(s);
    });

    doc.fontSize(11).font('Helvetica');
    Object.entries(byCat)
      .sort((a, b) => b[1].amount - a[1].amount)
      .forEach(([cat, data]) => {
        doc
          .fillColor('#333333')
          .text(`${cat}`, marginL, doc.y, { continued: true, width: 200 });
        doc.fillColor('#888888').text(`  ${data.count} subs`, { continued: true });
        doc
          .fillColor('#1A1A1A')
          .text(`  ${currency} ${data.amount.toFixed(2)}/mo`, {
            align: 'right',
            width: contentW - 280,
          });
      });
    doc.moveDown(1);

    drawDivider();

    // Top subscriptions
    doc
      .fontSize(14)
      .font('Helvetica-Bold')
      .fillColor('#1A1A1A')
      .text('Top Subscriptions');
    doc.moveDown(0.5);
    doc.fontSize(11).font('Helvetica');
    subs.slice(0, 10).forEach((s, i) => {
      const monthly = this.getMonthlyAmount(s);
      doc
        .fillColor('#888888')
        .text(`${i + 1}.`, marginL, doc.y, { continued: true, width: 20 });
      doc
        .fillColor('#1A1A1A')
        .text(` ${s.name}`, { continued: true, width: 250 });
      doc
        .fillColor('#6C47FF')
        .text(`${s.currency} ${monthly.toFixed(2)}/mo`, {
          align: 'right',
          width: contentW - 280,
        });
    });

    // Status breakdown
    doc.moveDown(1);
    drawDivider();
    doc
      .fontSize(14)
      .font('Helvetica-Bold')
      .fillColor('#1A1A1A')
      .text('By Status');
    doc.moveDown(0.5);
    doc.fontSize(11).font('Helvetica');
    const byStatus: Record<string, number> = {};
    subs.forEach((s) => {
      byStatus[s.status] = (byStatus[s.status] || 0) + 1;
    });
    Object.entries(byStatus).forEach(([status, count]) => {
      doc
        .fillColor('#333333')
        .text(`${status}: ${count} subscription${count > 1 ? 's' : ''}`);
    });
  }

  private addDetailedContent(
    doc: any,
    subs: Subscription[],
    cardMap: Record<string, PaymentCard>,
    iconMap: Map<string, Buffer>,
    marginL: number,
    contentW: number,
    drawDivider: () => void,
  ) {
    const totalMonthly = subs.reduce(
      (sum, s) => sum + this.getMonthlyAmount(s),
      0,
    );
    const currency = subs[0]?.currency || 'USD';

    doc
      .fontSize(16)
      .font('Helvetica-Bold')
      .fillColor('#1A1A1A')
      .text(`Subscriptions (${subs.length})`);
    doc
      .fontSize(10)
      .font('Helvetica')
      .fillColor('#888888')
      .text(`Total: ${currency} ${totalMonthly.toFixed(2)}/mo`);
    doc.moveDown(1);

    subs.forEach((s, i) => {
      // Check if we need a new page
      if (doc.y > 700) doc.addPage();

      const card = s.paymentCardId ? cardMap[s.paymentCardId] : null;
      const iconBuf = iconMap.get(s.id);
      const startY = doc.y;

      // Icon
      let textX = marginL;
      if (iconBuf) {
        try {
          doc.image(iconBuf, marginL, startY, { width: 24, height: 24 });
          textX = marginL + 32;
        } catch {
          /* icon failed, skip */
        }
      } else {
        // Draw letter circle
        doc.circle(marginL + 12, startY + 12, 12).fill('#6C47FF');
        doc
          .fontSize(12)
          .font('Helvetica-Bold')
          .fillColor('#FFFFFF')
          .text((s.name?.[0] || '?').toUpperCase(), marginL + 4, startY + 5, {
            width: 16,
            align: 'center',
          });
        textX = marginL + 32;
        doc.fillColor('#000000');
      }

      // Name + amount
      doc
        .fontSize(13)
        .font('Helvetica-Bold')
        .fillColor('#1A1A1A')
        .text(s.name, textX, startY, { width: contentW - 180 });
      doc
        .fontSize(13)
        .font('Helvetica-Bold')
        .fillColor('#6C47FF')
        .text(
          `${s.currency} ${Number(s.amount).toFixed(2)}${this.periodLabel(s.billingPeriod)}`,
          marginL,
          startY,
          { align: 'right', width: contentW },
        );

      // Details line
      doc.y = startY + 20;
      doc.fontSize(9).font('Helvetica').fillColor('#888888');
      const details: string[] = [];
      details.push(`${s.category}`);
      details.push(`Status: ${s.status}`);
      if (s.currentPlan) details.push(`Plan: ${s.currentPlan}`);
      if (card) details.push(`Card: ••••${card.last4} (${card.brand})`);
      doc.text(details.join('  \u00B7  '), textX, doc.y);

      // Dates line
      const dates: string[] = [];
      if (s.startDate)
        dates.push(`Started: ${this.formatDate(s.startDate)}`);
      if (s.nextPaymentDate)
        dates.push(`Next payment: ${this.formatDate(s.nextPaymentDate)}`);
      if (s.cancelledAt)
        dates.push(`Cancelled: ${this.formatDate(s.cancelledAt)}`);
      if (dates.length) {
        doc.text(dates.join('  \u00B7  '), textX, doc.y);
      }

      doc.moveDown(0.8);
      if (i < subs.length - 1) drawDivider();
    });
  }

  private addTaxContent(
    doc: any,
    subs: Subscription[],
    cardMap: Record<string, PaymentCard>,
    marginL: number,
    contentW: number,
    drawDivider: () => void,
  ) {
    const businessSubs = subs.filter((s) => s.isBusinessExpense);
    const personalSubs = subs.filter((s) => !s.isBusinessExpense);
    const businessTotal = businessSubs.reduce(
      (sum, s) => sum + Number(s.amount),
      0,
    );
    const personalTotal = personalSubs.reduce(
      (sum, s) => sum + Number(s.amount),
      0,
    );
    const currency = subs[0]?.currency || 'USD';

    // Summary
    doc
      .fontSize(16)
      .font('Helvetica-Bold')
      .fillColor('#1A1A1A')
      .text('Tax Summary');
    doc.moveDown(0.5);
    doc.fontSize(12).font('Helvetica');
    doc
      .fillColor('#10B981')
      .text(
        `Business expenses: ${currency} ${businessTotal.toFixed(2)}`,
        marginL,
        doc.y,
        { continued: true },
      )
      .fillColor('#888888')
      .text(`  (${businessSubs.length} subscriptions)`);
    doc
      .fillColor('#333333')
      .text(
        `Personal expenses: ${currency} ${personalTotal.toFixed(2)}`,
        marginL,
        doc.y,
        { continued: true },
      )
      .fillColor('#888888')
      .text(`  (${personalSubs.length} subscriptions)`);
    doc.moveDown(1);
    drawDivider();

    // Business expenses table
    if (businessSubs.length > 0) {
      doc
        .fontSize(14)
        .font('Helvetica-Bold')
        .fillColor('#1A1A1A')
        .text('Business Expenses');
      doc.moveDown(0.5);

      // Table header
      doc.fontSize(9).font('Helvetica-Bold').fillColor('#888888');
      doc.text('Service', marginL, doc.y, { width: 150, continued: false });
      const headerY = doc.y - 11;
      doc.text('Category', marginL + 155, headerY, { width: 90 });
      doc.text('Amount', marginL + 250, headerY, { width: 80 });
      doc.text('Period', marginL + 335, headerY, { width: 60 });
      doc.text('Card', marginL + 400, headerY, { width: 95 });
      doc.moveDown(0.3);
      drawDivider();

      doc.font('Helvetica').fontSize(9).fillColor('#333333');
      businessSubs.forEach((s) => {
        if (doc.y > 740) doc.addPage();
        const card = s.paymentCardId ? cardMap[s.paymentCardId] : null;
        const rowY = doc.y;
        doc.text(s.name.substring(0, 22), marginL, rowY, { width: 150 });
        doc.text(s.category, marginL + 155, rowY, { width: 90 });
        doc
          .fillColor('#1A1A1A')
          .text(
            `${s.currency} ${Number(s.amount).toFixed(2)}`,
            marginL + 250,
            rowY,
            { width: 80 },
          );
        doc
          .fillColor('#333333')
          .text(s.billingPeriod, marginL + 335, rowY, { width: 60 });
        doc.text(card ? `••••${card.last4}` : '\u2014', marginL + 400, rowY, {
          width: 95,
        });
        doc.moveDown(0.6);
      });

      doc.moveDown(0.5);
      doc
        .fontSize(12)
        .font('Helvetica-Bold')
        .fillColor('#10B981')
        .text(`Total deductible: ${currency} ${businessTotal.toFixed(2)}`);
      doc.moveDown(1);
      drawDivider();
    }

    // Personal expenses
    if (personalSubs.length > 0) {
      doc
        .fontSize(14)
        .font('Helvetica-Bold')
        .fillColor('#1A1A1A')
        .text('Personal Expenses');
      doc.moveDown(0.5);
      doc.font('Helvetica').fontSize(9).fillColor('#888888');
      personalSubs.forEach((s) => {
        if (doc.y > 740) doc.addPage();
        doc
          .fillColor('#333333')
          .text(`${s.name}`, marginL, doc.y, { continued: true, width: 200 });
        doc.fillColor('#888888').text(`  ${s.category}`, { continued: true });
        doc
          .fillColor('#333333')
          .text(
            `  ${s.currency} ${Number(s.amount).toFixed(2)}`,
            { align: 'right', width: contentW - 300 },
          );
      });
    }
  }
}
