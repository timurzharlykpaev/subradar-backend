import { PushI18n } from '../types';

const fmtAmount = (a: number | string, c: string) => `${c} ${a}`;

export const zh: PushI18n = {
  paymentReminder: ({ name, amount, currency, daysLeft, dateStr }) => ({
    title: `⏰ ${name} 将在 ${daysLeft} 天后扣款`,
    body: `${fmtAmount(amount, currency)} · ${dateStr}`,
  }),

  trialExpiry: ({ daysLeft }) => ({
    title: `您的 Pro 试用将在 ${daysLeft} 天后结束`,
    body: '立即升级，继续享受无限订阅和 AI 功能',
  }),

  proExpiration: ({ daysLeft }) => {
    if (daysLeft === 0) {
      return { title: 'SubRadar Pro', body: '您的 Pro 权益已结束' };
    }
    if (daysLeft === 1) {
      return { title: 'SubRadar Pro', body: 'Pro 的最后一天！' };
    }
    return {
      title: 'SubRadar Pro',
      body: `您的 Pro 订阅将在 ${daysLeft} 天后结束`,
    };
  },

  weeklyDigest: ({ currency, totalMonthly, activeCount, renewingThisWeek }) => ({
    title: `📊 ${currency} ${totalMonthly.toFixed(0)}/月，共 ${activeCount} 个订阅`,
    body:
      renewingThisWeek > 0
        ? `本周将续订 ${renewingThisWeek} 个`
        : '您的每周订阅摘要',
  }),

  winBack: ({ upcomingCount }) => ({
    title: '👀 别错过即将到来的扣款',
    body: `本周有 ${upcomingCount} 个订阅将续订`,
  }),

  upcomingBilling: ({ subscriptionName, amount, currency, billingDate }) => ({
    title: '🔔 即将扣款',
    body: `${subscriptionName} 将于 ${billingDate} 扣款 ${fmtAmount(amount, currency)}`,
  }),
};
