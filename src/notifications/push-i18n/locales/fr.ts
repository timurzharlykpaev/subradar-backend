import { PushI18n } from '../types';

const fmtAmount = (a: number | string, c: string) => `${a} ${c}`;

export const fr: PushI18n = {
  paymentReminder: ({ name, amount, currency, daysLeft, dateStr }) => ({
    title: `⏰ ${name} sera prélevé dans ${daysLeft === 1 ? '1 jour' : `${daysLeft} jours`}`,
    body: `${fmtAmount(amount, currency)} · ${dateStr}`,
  }),

  trialExpiry: ({ daysLeft }) => ({
    title: `Votre essai Pro se termine dans ${daysLeft === 1 ? '1 jour' : `${daysLeft} jours`}`,
    body: 'Passez à Pro pour garder les abonnements illimités et l’AI',
  }),

  proExpiration: ({ daysLeft }) => {
    if (daysLeft === 0) {
      return { title: 'SubRadar Pro', body: 'Vos avantages Pro sont terminés' };
    }
    if (daysLeft === 1) {
      return { title: 'SubRadar Pro', body: 'Dernier jour de Pro !' };
    }
    return {
      title: 'SubRadar Pro',
      body: `Votre abonnement Pro se termine dans ${daysLeft} jours`,
    };
  },

  weeklyDigest: ({ currency, totalMonthly, activeCount, renewingThisWeek }) => ({
    title: `📊 ${totalMonthly.toFixed(0)} ${currency}/mois pour ${activeCount} abonnement${activeCount === 1 ? '' : 's'}`,
    body:
      renewingThisWeek > 0
        ? `${renewingThisWeek} renouvellement${renewingThisWeek === 1 ? '' : 's'} cette semaine`
        : 'Votre récap hebdomadaire des abonnements',
  }),

  winBack: ({ upcomingCount }) => ({
    title: '👀 Ne ratez pas les prochains prélèvements',
    body: `${upcomingCount} abonnement${upcomingCount === 1 ? '' : 's'} se renouvelle${upcomingCount === 1 ? '' : 'nt'} cette semaine`,
  }),

  upcomingBilling: ({ subscriptionName, amount, currency, billingDate }) => ({
    title: '🔔 Prélèvement à venir',
    body: `${subscriptionName} sera prélevé de ${fmtAmount(amount, currency)} le ${billingDate}`,
  }),
};
