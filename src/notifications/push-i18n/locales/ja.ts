import { PushI18n } from '../types';

const fmtAmount = (a: number | string, c: string) => `${c} ${a}`;

export const ja: PushI18n = {
  paymentReminder: ({ name, amount, currency, daysLeft, dateStr }) => ({
    title: `⏰ ${name} は ${daysLeft} 日後に請求されます`,
    body: `${fmtAmount(amount, currency)} · ${dateStr}`,
  }),

  paymentRemindersDigest: ({ count, totalAmount, currency, earliestDays, topNames }) => {
    const when =
      earliestDays === 0 ? '本日' : earliestDays === 1 ? '明日' : `${earliestDays}日後`;
    const more = count > topNames.length ? `、他${count - topNames.length}件` : '';
    return {
      title: `⏰ ${when}に${count}件のサブスク更新`,
      body: `${topNames.join('、')}${more} · ${fmtAmount(totalAmount.toFixed(2), currency)}`,
    };
  },

  trialExpiry: ({ daysLeft }) => ({
    title: `Pro トライアルは ${daysLeft} 日後に終了します`,
    body: '今すぐアップグレードして、無制限のサブスクと AI 機能を継続',
  }),

  proExpiration: ({ daysLeft }) => {
    if (daysLeft === 0) {
      return { title: 'SubRadar Pro', body: 'Pro 特典が終了しました' };
    }
    if (daysLeft === 1) {
      return { title: 'SubRadar Pro', body: 'Pro 最終日です！' };
    }
    return {
      title: 'SubRadar Pro',
      body: `Pro サブスクリプションは ${daysLeft} 日後に終了します`,
    };
  },

  weeklyDigest: ({ currency, totalMonthly, activeCount, renewingThisWeek }) => ({
    title: `📊 ${currency} ${totalMonthly.toFixed(0)}/月、${activeCount} 件のサブスク`,
    body:
      renewingThisWeek > 0
        ? `今週 ${renewingThisWeek} 件が更新されます`
        : '今週のサブスクサマリー',
  }),

  winBack: ({ upcomingCount }) => ({
    title: '👀 まもなくの請求をお見逃しなく',
    body: `今週 ${upcomingCount} 件のサブスクが更新されます`,
  }),

  upcomingBilling: ({ subscriptionName, amount, currency, billingDate }) => ({
    title: '🔔 請求予定',
    body: `${subscriptionName} は ${billingDate} に ${fmtAmount(amount, currency)} 請求されます`,
  }),
};
