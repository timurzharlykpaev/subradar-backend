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

  gmailScanComplete: ({ candidates }) =>
    candidates > 0
      ? {
          title: '✨ Gmail スキャンが完了',
          body: `受信箱から ${candidates} 件のサブスク候補が見つかりました`,
        }
      : {
          title: 'Gmail スキャンが完了',
          body: '新しいサブスクは見つかりませんでした — 検出されたものはすでにリストにあります',
        },

  subscriptionTrialEnding: ({ name, daysLeft }) => ({
    title: 'トライアル終了間近',
    body:
      daysLeft <= 1
        ? `${name} のトライアルは明日終了します — 課金を避けるには今すぐキャンセル`
        : `${name} のトライアルは ${daysLeft} 日後に終了します`,
  }),

  proTrialExpiring: () => ({
    title: '⏰ SubRadar のトライアルが明日終了します',
    body: '今すぐ登録して、すべての機能への無制限アクセスを継続しましょう',
  }),

  proTrialExpired: () => ({
    title: '🔓 無料トライアルが終了しました',
    body: 'SubRadar Pro に登録して、無制限アクセスを取り戻しましょう',
  }),
};
