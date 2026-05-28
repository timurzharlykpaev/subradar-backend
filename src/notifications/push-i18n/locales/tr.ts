import { PushI18n } from '../types';

const fmtAmount = (a: number | string, c: string) => `${c} ${a}`;

export const tr: PushI18n = {
  paymentReminder: ({ name, amount, currency, daysLeft, dateStr }) => ({
    title: `⏰ ${name} ${daysLeft === 1 ? '1 gün' : `${daysLeft} gün`} içinde ücretlendirilir`,
    body: `${fmtAmount(amount, currency)} · ${dateStr}`,
  }),

  paymentRemindersDigest: ({ count, totalAmount, currency, earliestDays, topNames }) => {
    const when =
      earliestDays === 0 ? 'bugün' : earliestDays === 1 ? 'yarın' : `${earliestDays} gün içinde`;
    const more = count > topNames.length ? `, +${count - topNames.length} daha` : '';
    return {
      title: `⏰ ${count} abonelik ${when} yenileniyor`,
      body: `${topNames.join(', ')}${more} · ${fmtAmount(totalAmount.toFixed(2), currency)}`,
    };
  },

  trialExpiry: ({ daysLeft }) => ({
    title: `Pro denemen ${daysLeft === 1 ? '1 gün' : `${daysLeft} gün`} içinde bitiyor`,
    body: 'Sınırsız abonelikler ve AI özelliklerini korumak için şimdi yükselt',
  }),

  proExpiration: ({ daysLeft }) => {
    if (daysLeft === 0) {
      return { title: 'SubRadar Pro', body: 'Pro avantajların sona erdi' };
    }
    if (daysLeft === 1) {
      return { title: 'SubRadar Pro', body: 'Pro\'nun son günü!' };
    }
    return {
      title: 'SubRadar Pro',
      body: `Pro aboneliğin ${daysLeft} gün içinde bitiyor`,
    };
  },

  weeklyDigest: ({ currency, totalMonthly, activeCount, renewingThisWeek }) => ({
    title: `📊 ${currency} ${totalMonthly.toFixed(0)}/ay · ${activeCount} abonelik`,
    body:
      renewingThisWeek > 0
        ? `Bu hafta ${renewingThisWeek} tanesi yenileniyor`
        : 'Haftalık abonelik özetin',
  }),

  winBack: ({ upcomingCount }) => ({
    title: '👀 Yaklaşan ödemeleri kaçırma',
    body: `Bu hafta ${upcomingCount} abonelik yenileniyor`,
  }),

  gmailScanComplete: ({ candidates }) =>
    candidates > 0
      ? {
          title: '✨ Gmail taraması hazır',
          body: `Gelen kutunda ${candidates} olası abonelik bulundu`,
        }
      : {
          title: 'Gmail taraması tamamlandı',
          body: 'Yeni abonelik bulunamadı — tespit edilen her şey zaten listende',
        },

  subscriptionTrialEnding: ({ name, daysLeft }) => ({
    title: 'Deneme yakında bitiyor',
    body:
      daysLeft <= 1
        ? `${name} denemen yarın bitiyor — ücretleri önlemek için şimdi iptal et`
        : `${name} denemen ${daysLeft} gün içinde bitiyor`,
  }),

  proTrialExpiring: () => ({
    title: '⏰ SubRadar denemeni yarın bitiyor',
    body: 'Tüm özelliklere sınırsız erişimi korumak için şimdi abone ol',
  }),

  proTrialExpired: () => ({
    title: '🔓 Ücretsiz denemen sona erdi',
    body: 'Sınırsız erişimi geri kazanmak için SubRadar Pro\'ya abone ol',
  }),

  refundProcessed: () => ({
    title: 'İade işlendi',
    body: 'Aboneliğin iade edildi ve erişim kaldırıldı',
  }),
};
