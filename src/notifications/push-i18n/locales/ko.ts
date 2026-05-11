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

  gmailScanComplete: ({ candidates }) =>
    candidates > 0
      ? {
          title: '✨ Gmail 스캔 완료',
          body: `받은편지함에서 잠재적 구독 ${candidates}개를 찾았습니다`,
        }
      : {
          title: 'Gmail 스캔 완료',
          body: '새 구독을 찾지 못했습니다 — 감지된 항목은 이미 목록에 있습니다',
        },

  subscriptionTrialEnding: ({ name, daysLeft }) => ({
    title: '체험 종료 임박',
    body:
      daysLeft <= 1
        ? `${name} 체험이 내일 종료됩니다 — 청구를 피하려면 지금 취소하세요`
        : `${name} 체험이 ${daysLeft}일 후 종료됩니다`,
  }),

  proTrialExpiring: () => ({
    title: '⏰ SubRadar 체험이 내일 종료됩니다',
    body: '지금 구독하고 모든 기능에 대한 무제한 액세스를 유지하세요',
  }),

  proTrialExpired: () => ({
    title: '🔓 무료 체험이 종료되었습니다',
    body: 'SubRadar Pro를 구독하여 무제한 액세스를 복구하세요',
  }),

  refundProcessed: () => ({
    title: '환불이 처리되었습니다',
    body: '구독이 환불되었으며 액세스가 제거되었습니다',
  }),
};
