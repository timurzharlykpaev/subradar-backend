import { PushI18n } from '../types';

const fmtAmount = (a: number | string, c: string) => `${c} ${a}`;

export const zh: PushI18n = {
  paymentReminder: ({ name, amount, currency, daysLeft, dateStr }) => ({
    title: `⏰ ${name} 将在 ${daysLeft} 天后扣款`,
    body: `${fmtAmount(amount, currency)} · ${dateStr}`,
  }),

  paymentRemindersDigest: ({ count, totalAmount, currency, earliestDays, topNames }) => {
    const when =
      earliestDays === 0 ? '今天' : earliestDays === 1 ? '明天' : `${earliestDays}天后`;
    const more = count > topNames.length ? `,还有${count - topNames.length}个` : '';
    return {
      title: `⏰ ${when}有${count}个订阅续费`,
      body: `${topNames.join('、')}${more} · ${fmtAmount(totalAmount.toFixed(2), currency)}`,
    };
  },

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

  gmailScanComplete: ({ candidates }) =>
    candidates > 0
      ? {
          title: '✨ Gmail 扫描已完成',
          body: `在您的邮箱中找到 ${candidates} 个潜在订阅`,
        }
      : {
          title: 'Gmail 扫描已完成',
          body: '未找到新订阅 — 我们检测到的内容已在您的列表中',
        },

  subscriptionTrialEnding: ({ name, daysLeft }) => ({
    title: '试用即将结束',
    body:
      daysLeft <= 1
        ? `您的 ${name} 试用将于明天结束 — 立即取消以避免扣款`
        : `您的 ${name} 试用将在 ${daysLeft} 天后结束`,
  }),

  proTrialExpiring: () => ({
    title: '⏰ 您的 SubRadar 试用将于明天结束',
    body: '立即订阅，继续无限制使用所有功能',
  }),

  proTrialExpired: () => ({
    title: '🔓 您的免费试用已结束',
    body: '订阅 SubRadar Pro 以恢复无限制访问',
  }),

  refundProcessed: () => ({
    title: '退款已处理',
    body: '您的订阅已退款,访问权限已移除',
  }),
};
