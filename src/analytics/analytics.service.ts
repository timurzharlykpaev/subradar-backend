import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Subscription, SubscriptionStatus, BillingPeriod } from '../subscriptions/entities/subscription.entity';
import { PaymentCard } from '../payment-cards/entities/payment-card.entity';

@Injectable()
export class AnalyticsService {
  constructor(
    @InjectRepository(Subscription) private readonly subRepo: Repository<Subscription>,
    @InjectRepository(PaymentCard) private readonly cardRepo: Repository<PaymentCard>,
  ) {}

  private toMonthlyAmount(amount: number, period: BillingPeriod): number {
    const map: Record<BillingPeriod, number> = {
      [BillingPeriod.WEEKLY]: amount * 4.33,
      [BillingPeriod.MONTHLY]: amount,
      [BillingPeriod.QUARTERLY]: amount / 3,
      [BillingPeriod.YEARLY]: amount / 12,
      [BillingPeriod.LIFETIME]: 0,
      [BillingPeriod.ONE_TIME]: 0,
    };
    return map[period] ?? amount;
  }

  async getSummary(userId: string, month?: number, year?: number) {
    const subs = await this.subRepo.find({ where: { userId } });
    const active = subs.filter((s) => s.status === SubscriptionStatus.ACTIVE || s.status === SubscriptionStatus.TRIAL);

    const totalMonthly = active.reduce((sum, s) => sum + this.toMonthlyAmount(Number(s.amount), s.billingPeriod), 0);
    const totalYearly = totalMonthly * 12;
    const totalSubscriptions = active.length;
    const businessExpenses = active.filter((s) => s.isBusinessExpense).reduce((sum, s) => sum + this.toMonthlyAmount(Number(s.amount), s.billingPeriod), 0);

    return {
      totalMonthly: Math.round(totalMonthly * 100) / 100,
      totalYearly: Math.round(totalYearly * 100) / 100,
      totalSubscriptions,
      businessExpenses: Math.round(businessExpenses * 100) / 100,
      averagePerSubscription: totalSubscriptions > 0 ? Math.round((totalMonthly / totalSubscriptions) * 100) / 100 : 0,
    };
  }

  async getMonthly(userId: string, months = 12) {
    const result: Array<{ month: number; year: number; label: string; total: number }> = [];
    const now = new Date();

    for (let i = months - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const month = d.getMonth() + 1;
      const year = d.getFullYear();

      const subs = await this.subRepo
        .createQueryBuilder('s')
        .where('s.userId = :userId', { userId })
        .andWhere('s.status IN (:...statuses)', { statuses: [SubscriptionStatus.ACTIVE, SubscriptionStatus.TRIAL] })
        .andWhere('(s.startDate IS NULL OR s.startDate <= :endOfMonth)', { endOfMonth: new Date(year, month, 0) })
        .getMany();

      const total = subs.reduce((sum, s) => sum + this.toMonthlyAmount(Number(s.amount), s.billingPeriod), 0);
      result.push({ month, year, label: `${year}-${String(month).padStart(2, '0')}`, total: Math.round(total * 100) / 100 });
    }

    return result;
  }

  async getByCategory(userId: string, month?: number, year?: number) {
    const subs = await this.subRepo.find({ where: { userId } });
    const active = subs.filter((s) => s.status === SubscriptionStatus.ACTIVE || s.status === SubscriptionStatus.TRIAL);

    const map: Record<string, number> = {};
    for (const s of active) {
      const monthly = this.toMonthlyAmount(Number(s.amount), s.billingPeriod);
      map[s.category] = (map[s.category] || 0) + monthly;
    }

    return Object.entries(map).map(([category, total]) => ({
      category,
      total: Math.round(total * 100) / 100,
    })).sort((a, b) => b.total - a.total);
  }

  async getUpcoming(userId: string, days = 7) {
    const now = new Date();
    const future = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);

    const subs = await this.subRepo.find({ where: { userId } });
    return subs
      .filter((s) => {
        if (s.status === SubscriptionStatus.CANCELLED) return false;
        if (!s.billingDay) return false;
        const nextDate = new Date(now.getFullYear(), now.getMonth(), s.billingDay);
        if (nextDate < now) nextDate.setMonth(nextDate.getMonth() + 1);
        return nextDate <= future;
      })
      .map((s) => {
        const nextDate = new Date(now.getFullYear(), now.getMonth(), s.billingDay);
        if (nextDate < now) nextDate.setMonth(nextDate.getMonth() + 1);
        return { ...s, nextBillingDate: nextDate };
      })
      .sort((a, b) => a.nextBillingDate.getTime() - b.nextBillingDate.getTime());
  }

  async getByCard(userId: string) {
    const cards = await this.cardRepo.find({ where: { userId } });
    const subs = await this.subRepo.find({ where: { userId } });
    const active = subs.filter((s) => s.status === SubscriptionStatus.ACTIVE || s.status === SubscriptionStatus.TRIAL);

    const unassigned = active.filter((s) => !s.paymentCardId);
    const unassignedTotal = unassigned.reduce((sum, s) => sum + this.toMonthlyAmount(Number(s.amount), s.billingPeriod), 0);

    const result: Array<{ card: { id: string | null; nickname: string; last4: string | null; brand: any; color: string | null }; subscriptions: number; total: number }> = cards.map((card) => {
      const cardSubs = active.filter((s) => s.paymentCardId === card.id);
      const total = cardSubs.reduce((sum, s) => sum + this.toMonthlyAmount(Number(s.amount), s.billingPeriod), 0);
      return {
        card: { id: card.id as string | null, nickname: card.nickname, last4: card.last4 as string | null, brand: card.brand as any, color: card.color as string | null },
        subscriptions: cardSubs.length,
        total: Math.round(total * 100) / 100,
      };
    });

    if (unassigned.length > 0) {
      result.push({
        card: { id: null as string | null, nickname: 'Unassigned', last4: null as string | null, brand: null as any, color: null as string | null },
        subscriptions: unassigned.length,
        total: Math.round(unassignedTotal * 100) / 100,
      });
    }

    return result;
  }
}
