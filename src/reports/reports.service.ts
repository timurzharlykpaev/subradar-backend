import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between } from 'typeorm';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const PDFDocument = require('pdfkit');
import { Report, ReportType } from './entities/report.entity';
import { Subscription } from '../subscriptions/entities/subscription.entity';
import { PaymentCard } from '../payment-cards/entities/payment-card.entity';

@Injectable()
export class ReportsService {
  constructor(
    @InjectRepository(Report) private readonly reportRepo: Repository<Report>,
    @InjectRepository(Subscription) private readonly subRepo: Repository<Subscription>,
    @InjectRepository(PaymentCard) private readonly cardRepo: Repository<PaymentCard>,
  ) {}

  async generate(userId: string, from: string, to: string, type: ReportType): Promise<Report> {
    const report = this.reportRepo.create({ userId, from, to, type, status: 'ready' });
    return this.reportRepo.save(report);
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

  async generatePdf(userId: string, id: string): Promise<Buffer> {
    const report = await this.findOne(userId, id);
    const cards = await this.cardRepo.find({ where: { userId } });
    const cardMap = Object.fromEntries(cards.map((c) => [c.id, c]));

    const subs = await this.subRepo
      .createQueryBuilder('s')
      .where('s.userId = :userId', { userId })
      .andWhere('(s.startDate IS NULL OR s.startDate >= :from)', { from: report.from })
      .andWhere('(s.startDate IS NULL OR s.startDate <= :to)', { to: report.to })
      .getMany();

    return new Promise<Buffer>((resolve, reject) => {
      const doc = new PDFDocument({ margin: 50 }) as any;
      const buffers: Buffer[] = [];

      doc.on('data', (chunk) => buffers.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(buffers)));
      doc.on('error', reject);

      // Header
      doc.fontSize(24).font('Helvetica-Bold').text('SubRadar AI', { align: 'center' });
      doc.fontSize(16).font('Helvetica').text(`${report.type.toUpperCase()} Report`, { align: 'center' });
      doc.moveDown();
      doc.fontSize(12).text(`Period: ${report.from} to ${report.to}`, { align: 'center' });
      doc.moveDown(2);

      if (report.type === ReportType.SUMMARY) {
        this.addSummaryContent(doc, subs);
      } else if (report.type === ReportType.DETAILED) {
        this.addDetailedContent(doc, subs, cardMap);
      } else if (report.type === ReportType.TAX) {
        this.addTaxContent(doc, subs, cardMap);
      }

      doc.end();
    });
  }

  private addSummaryContent(doc: any, subs: Subscription[]) {
    const total = subs.reduce((sum, s) => sum + Number(s.amount), 0);
    doc.fontSize(14).font('Helvetica-Bold').text('Summary');
    doc.moveDown();
    doc.fontSize(12).font('Helvetica');
    doc.text(`Total Subscriptions: ${subs.length}`);
    doc.text(`Total Amount: $${total.toFixed(2)}`);
    doc.moveDown();

    // Category breakdown
    const byCat: Record<string, number> = {};
    subs.forEach((s) => { byCat[s.category] = (byCat[s.category] || 0) + Number(s.amount); });
    doc.font('Helvetica-Bold').text('By Category:');
    doc.font('Helvetica');
    Object.entries(byCat).forEach(([cat, amt]) => {
      doc.text(`  ${cat}: $${amt.toFixed(2)}`);
    });
  }

  private addDetailedContent(doc: any, subs: Subscription[], cardMap: Record<string, PaymentCard>) {
    doc.fontSize(14).font('Helvetica-Bold').text('Subscription Details');
    doc.moveDown();

    subs.forEach((s, i) => {
      const card = s.paymentCardId ? cardMap[s.paymentCardId] : null;
      doc.fontSize(12).font('Helvetica-Bold').text(`${i + 1}. ${s.name}`);
      doc.font('Helvetica');
      doc.text(`   Category: ${s.category} | Amount: ${s.currency} ${s.amount} | Period: ${s.billingPeriod}`);
      doc.text(`   Status: ${s.status} | Added: ${s.addedVia}`);
      if (card) doc.text(`   Card: ••••${card.last4} (${card.brand})`);
      doc.moveDown(0.5);
    });
  }

  private addTaxContent(doc: any, subs: Subscription[], cardMap: Record<string, PaymentCard>) {
    doc.fontSize(14).font('Helvetica-Bold').text('Tax Report');
    doc.moveDown();

    // Table header
    const cols = [50, 180, 280, 340, 390, 460, 510];
    const headers = ['Service', 'Category', 'Amount', 'Currency', 'Card', 'Period', 'Business'];
    doc.fontSize(9).font('Helvetica-Bold');
    headers.forEach((h, i) => doc.text(h, cols[i], doc.y, { continued: i < headers.length - 1 }));
    doc.moveDown(0.5);

    const lineY = doc.y;
    doc.moveTo(50, lineY).lineTo(550, lineY).stroke();
    doc.moveDown(0.3);

    // Table rows
    doc.font('Helvetica').fontSize(9);
    subs.forEach((s) => {
      const card = s.paymentCardId ? cardMap[s.paymentCardId] : null;
      const rowY = doc.y;
      const row = [
        s.name.substring(0, 18),
        s.category,
        String(s.amount),
        s.currency,
        card ? `••••${card.last4}` : 'N/A',
        s.billingPeriod,
        s.isBusinessExpense ? 'Yes' : 'No',
      ];
      row.forEach((val, i) => {
        doc.text(val, cols[i], rowY, { continued: i < row.length - 1 });
      });
      doc.moveDown(0.4);
    });

    doc.moveDown();
    const businessTotal = subs.filter((s) => s.isBusinessExpense).reduce((sum, s) => sum + Number(s.amount), 0);
    doc.font('Helvetica-Bold').fontSize(11);
    doc.text(`Business Expenses Total: $${businessTotal.toFixed(2)}`);
  }
}
