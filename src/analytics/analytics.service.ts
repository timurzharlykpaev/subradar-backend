import { Injectable, Inject } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, In, Repository } from 'typeorm';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../common/redis.module';
import {
  Subscription,
  SubscriptionStatus,
  BillingPeriod,
} from '../subscriptions/entities/subscription.entity';
import { PaymentCard } from '../payment-cards/entities/payment-card.entity';

@Injectable()
export class AnalyticsService {
  constructor(
    @InjectRepository(Subscription)
    private readonly subRepo: Repository<Subscription>,
    @InjectRepository(PaymentCard)
    private readonly cardRepo: Repository<PaymentCard>,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
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

  async getSummary(userId: string, _month?: number, _year?: number) {
    const cacheKey = `analytics:summary:${userId}:${_month || 'all'}:${_year || 'all'}`;
    try {
      const cached = await this.redis?.get(cacheKey);
      if (cached) return JSON.parse(cached);
    } catch { /* redis unavailable, proceed without cache */ }

    const subs = await this.subRepo.find({ where: { userId } });
    const active = subs.filter(
      (s) =>
        s.status === SubscriptionStatus.ACTIVE ||
        s.status === SubscriptionStatus.TRIAL,
    );

    const totalMonthly = active.reduce(
      (sum, s) => sum + this.toMonthlyAmount(Number(s.amount), s.billingPeriod),
      0,
    );
    const totalYearly = totalMonthly * 12;
    const totalSubscriptions = active.length;
    const businessExpenses = active
      .filter((s) => s.isBusinessExpense)
      .reduce(
        (sum, s) =>
          sum + this.toMonthlyAmount(Number(s.amount), s.billingPeriod),
        0,
      );

    const upcomingNext30 = await this.subRepo.find({
      where: {
        userId,
        status: In([SubscriptionStatus.ACTIVE, SubscriptionStatus.TRIAL]),
        nextPaymentDate: Between(
          new Date(),
          new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        ),
      },
      order: { nextPaymentDate: 'ASC' },
      take: 10,
    });

    const result = {
      totalMonthly: Math.round(totalMonthly * 100) / 100,
      totalYearly: Math.round(totalYearly * 100) / 100,
      monthlyTotal: Math.round(totalMonthly * 100) / 100,
      yearlyEstimate: Math.round(totalYearly * 100) / 100,
      activeCount: totalSubscriptions,
      totalSubscriptions,
      pausedCount: subs.filter((s) => s.status === SubscriptionStatus.PAUSED).length,
      trialCount: subs.filter((s) => s.status === SubscriptionStatus.TRIAL).length,
      savingsPossible: 0,
      businessExpenses: Math.round(businessExpenses * 100) / 100,
      averagePerSubscription:
        totalSubscriptions > 0
          ? Math.round((totalMonthly / totalSubscriptions) * 100) / 100
          : 0,
      upcomingNext30: upcomingNext30.map((s) => ({
        id: s.id,
        name: s.name,
        amount: Number(s.amount),
        nextPaymentDate: s.nextPaymentDate,
      })),
    };

    try {
      await this.redis?.set(cacheKey, JSON.stringify(result), 'EX', 300);
    } catch { /* redis unavailable, skip cache */ }

    return result;
  }

  async getMonthly(userId: string, months = 12) {
    const now = new Date();

    // Load all active/trial subscriptions once (fixes N+1)
    const allSubs = await this.subRepo
      .createQueryBuilder('s')
      .where('s.userId = :userId', { userId })
      .andWhere('s.status IN (:...statuses)', {
        statuses: [SubscriptionStatus.ACTIVE, SubscriptionStatus.TRIAL],
      })
      .getMany();

    const result: Array<{
      month: number;
      year: number;
      label: string;
      total: number;
    }> = [];

    for (let i = months - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const month = d.getMonth() + 1;
      const year = d.getFullYear();
      const endOfMonth = new Date(year, month, 0);

      // Filter in application code instead of querying DB per month
      const monthSubs = allSubs.filter(
        (s) => !s.startDate || new Date(s.startDate) <= endOfMonth,
      );

      const total = monthSubs.reduce(
        (sum, s) =>
          sum + this.toMonthlyAmount(Number(s.amount), s.billingPeriod),
        0,
      );
      result.push({
        month,
        year,
        label: `${year}-${String(month).padStart(2, '0')}`,
        total: Math.round(total * 100) / 100,
      });
    }

    return result;
  }

  async getByCategory(userId: string, _month?: number, _year?: number) {
    const subs = await this.subRepo.find({ where: { userId } });
    const active = subs.filter(
      (s) =>
        s.status === SubscriptionStatus.ACTIVE ||
        s.status === SubscriptionStatus.TRIAL,
    );

    const map: Record<string, number> = {};
    for (const s of active) {
      const monthly = this.toMonthlyAmount(Number(s.amount), s.billingPeriod);
      map[s.category] = (map[s.category] || 0) + monthly;
    }

    return Object.entries(map)
      .map(([category, total]) => ({
        category,
        total: Math.round(total * 100) / 100,
      }))
      .sort((a, b) => b.total - a.total);
  }

  async getUpcoming(userId: string, days = 7) {
    const now = new Date();
    const future = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);

    const subs = await this.subRepo.find({ where: { userId } });
    return subs
      .filter((s) => {
        if (s.status === SubscriptionStatus.CANCELLED) return false;
        if (!s.billingDay) return false;
        const nextDate = new Date(
          now.getFullYear(),
          now.getMonth(),
          s.billingDay,
        );
        if (nextDate < now) nextDate.setMonth(nextDate.getMonth() + 1);
        return nextDate <= future;
      })
      .map((s) => {
        const nextDate = new Date(
          now.getFullYear(),
          now.getMonth(),
          s.billingDay,
        );
        if (nextDate < now) nextDate.setMonth(nextDate.getMonth() + 1);
        return { ...s, nextBillingDate: nextDate };
      })
      .sort(
        (a, b) => a.nextBillingDate.getTime() - b.nextBillingDate.getTime(),
      );
  }

  async getTrials(userId: string) {
    const subs = await this.subRepo.find({
      where: { userId, status: SubscriptionStatus.TRIAL },
      relations: ['paymentCard'],
    });

    const now = Date.now();
    return subs.map((s) => {
      const daysUntilTrialEnd = s.trialEndDate
        ? Math.ceil(
            (new Date(s.trialEndDate).getTime() - now) / (24 * 60 * 60 * 1000),
          )
        : null;
      return {
        ...s,
        daysUntilTrialEnd,
        isExpiringSoon:
          daysUntilTrialEnd !== null && daysUntilTrialEnd >= 0 && daysUntilTrialEnd <= 3,
        isExpired: daysUntilTrialEnd !== null && daysUntilTrialEnd < 0,
      };
    });
  }

  async getForecast(userId: string) {
    const subscriptions = await this.subRepo.find({
      where: { userId, status: In([SubscriptionStatus.ACTIVE, SubscriptionStatus.TRIAL]) },
    });

    const monthlyTotal = subscriptions.reduce(
      (sum, s) => sum + this.toMonthlyAmount(Number(s.amount), s.billingPeriod),
      0,
    );

    return {
      forecast30d: Math.round(monthlyTotal * 100) / 100,
      forecast6mo: Math.round(monthlyTotal * 6 * 100) / 100,
      forecast12mo: Math.round(monthlyTotal * 12 * 100) / 100,
      currency: 'USD',
    };
  }

  async getSavings(userId: string) {
    const subscriptions = await this.subRepo.find({
      where: { userId, status: In([SubscriptionStatus.ACTIVE, SubscriptionStatus.TRIAL]) },
    });

    const byCategory: Record<string, any[]> = {};
    for (const sub of subscriptions) {
      const cat = sub.category || 'OTHER';
      if (!byCategory[cat]) byCategory[cat] = [];
      byCategory[cat].push(sub);
    }

    // Find duplicates: same category with 2+ subs, compare monthly amounts
    const duplicates: { subscriptionIds: string[]; name: string; category: string; count: number; totalMonthly: number; cheapest: number; potentialSavings: number }[] = [];
    for (const [cat, catSubs] of Object.entries(byCategory)) {
      if (catSubs.length > 1) {
        const withMonthly = catSubs.map((s) => ({
          ...s,
          monthlyAmount: this.toMonthlyAmount(Number(s.amount) || 0, s.billingPeriod),
        }));
        const sorted = [...withMonthly].sort((a, b) => a.monthlyAmount - b.monthlyAmount);
        const cheapest = sorted[0].monthlyAmount;
        const totalMonthly = sorted.reduce((sum, s) => sum + s.monthlyAmount, 0);
        // Potential savings = everything except the cheapest
        const savings = sorted.slice(1).reduce((sum, s) => sum + s.monthlyAmount, 0);
        if (savings > 0) {
          duplicates.push({
            subscriptionIds: sorted.map((s) => s.id),
            name: sorted.map((s) => s.name).join(', '),
            category: cat,
            count: catSubs.length,
            totalMonthly: Math.round(totalMonthly * 100) / 100,
            cheapest: Math.round(cheapest * 100) / 100,
            potentialSavings: Math.round(savings * 100) / 100,
          });
        }
      }
    }

    // Sort by potential savings descending
    duplicates.sort((a, b) => b.potentialSavings - a.potentialSavings);

    const estimatedMonthlySavings = duplicates.reduce((sum, d) => sum + d.potentialSavings, 0);

    // Generate insights
    const insights: string[] = [];
    if (duplicates.length > 0) {
      insights.push(`You have ${duplicates.length} categories with overlapping subscriptions.`);
      const topDup = duplicates[0];
      if (topDup) insights.push(`Biggest overlap: ${topDup.name} (${topDup.category}) — $${topDup.potentialSavings.toFixed(2)}/mo savings possible.`);
    }
    if (estimatedMonthlySavings > 50) {
      insights.push(`You could save $${estimatedMonthlySavings.toFixed(0)}/mo ($${(estimatedMonthlySavings * 12).toFixed(0)}/yr) by consolidating overlapping subscriptions.`);
    }

    return {
      estimatedMonthlySavings: Math.round(estimatedMonthlySavings * 100) / 100,
      duplicates: duplicates.slice(0, 10), // Limit to top 10
      insights,
    };
  }

  async getByCard(userId: string) {
    const cards = await this.cardRepo.find({ where: { userId } });
    const subs = await this.subRepo.find({ where: { userId } });
    const active = subs.filter(
      (s) =>
        s.status === SubscriptionStatus.ACTIVE ||
        s.status === SubscriptionStatus.TRIAL,
    );

    const unassigned = active.filter((s) => !s.paymentCardId);
    const unassignedTotal = unassigned.reduce(
      (sum, s) => sum + this.toMonthlyAmount(Number(s.amount), s.billingPeriod),
      0,
    );

    const result: Array<{
      card: {
        id: string | null;
        nickname: string;
        last4: string | null;
        brand: any;
        color: string | null;
      };
      subscriptions: number;
      total: number;
    }> = cards.map((card) => {
      const cardSubs = active.filter((s) => s.paymentCardId === card.id);
      const total = cardSubs.reduce(
        (sum, s) =>
          sum + this.toMonthlyAmount(Number(s.amount), s.billingPeriod),
        0,
      );
      return {
        card: {
          id: card.id as string | null,
          nickname: card.nickname,
          last4: card.last4 as string | null,
          brand: card.brand as any,
          color: card.color as string | null,
        },
        subscriptions: cardSubs.length,
        total: Math.round(total * 100) / 100,
      };
    });

    if (unassigned.length > 0) {
      result.push({
        card: {
          id: null as string | null,
          nickname: 'Unassigned',
          last4: null as string | null,
          brand: null as any,
          color: null as string | null,
        },
        subscriptions: unassigned.length,
        total: Math.round(unassignedTotal * 100) / 100,
      });
    }

    return result;
  }
}
