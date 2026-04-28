import { PushI18n } from '../types';

const fmtAmount = (a: number | string, c: string) => `${c} ${a}`;

export const ko: PushI18n = {
  paymentReminder: ({ name, amount, currency, daysLeft, dateStr }) => ({
    title: `⏰ ${name} 결제까지 ${daysLeft}일 남았습니다`,
    body: `${fmtAmount(amount, currency)} · ${dateStr}`,
  }),

  paymentRemindersDigest: ({ count, totalAmount, currency, earliestDays, topNames }) => {
    const when =
      earliestDays === 0 ? '오늘' : earliestDays === 1 ? '내일' : `${earliestDays}일 후`;
    const more = count > topNames.length ? `, 외 ${count - topNames.length}개` : '';
    return {
      title: `⏰ ${when} ${count}개 구독 갱신`,
      body: `${topNames.join(', ')}${more} · ${fmtAmount(totalAmount.toFixed(2), currency)}`,
    };
  },

  trialExpiry: ({ daysLeft }) => ({
    title: `Pro 체험이 ${daysLeft}일 후 종료됩니다`,
    body: '지금 업그레이드하고 무제한 구독과 AI 기능을 계속 이용하세요',
  }),

  proExpiration: ({ daysLeft }) => {
    if (daysLeft === 0) {
      return { title: 'SubRadar Pro', body: 'Pro 혜택이 종료되었습니다' };
    }
    if (daysLeft === 1) {
      return { title: 'SubRadar Pro', body: 'Pro 마지막 날입니다!' };
    }
    return {
      title: 'SubRadar Pro',
      body: `Pro 구독이 ${daysLeft}일 후 종료됩니다`,
    };
  },

  weeklyDigest: ({ currency, totalMonthly, activeCount, renewingThisWeek }) => ({
    title: `📊 월 ${currency} ${totalMonthly.toFixed(0)}, 구독 ${activeCount}개`,
    body:
      renewingThisWeek > 0
        ? `이번 주 ${renewingThisWeek}개 갱신 예정`
        : '주간 구독 요약',
  }),

  winBack: ({ upcomingCount }) => ({
    title: '👀 다가오는 결제를 놓치지 마세요',
    body: `이번 주 ${upcomingCount}개 구독이 갱신됩니다`,
  }),
};
