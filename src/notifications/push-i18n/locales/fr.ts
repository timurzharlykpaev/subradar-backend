import { PushI18n } from '../types';

const fmtAmount = (a: number | string, c: string) => `${a} ${c}`;

export const fr: PushI18n = {
  paymentReminder: ({ name, amount, currency, daysLeft, dateStr }) => ({
    title: `⏰ ${name} sera prélevé dans ${daysLeft === 1 ? '1 jour' : `${daysLeft} jours`}`,
    body: `${fmtAmount(amount, currency)} · ${dateStr}`,
  }),

  paymentRemindersDigest: ({ count, totalAmount, currency, earliestDays, topNames }) => {
    const when =
      earliestDays === 0
        ? "aujourd'hui"
        : earliestDays === 1
          ? 'demain'
          : `dans ${earliestDays} jours`;
    const more = count > topNames.length ? `, +${count - topNames.length} de plus` : '';
    return {
      title: `⏰ ${count} abonnement${count === 1 ? '' : 's'} ${when}`,
      body: `${topNames.join(', ')}${more} · ${fmtAmount(totalAmount.toFixed(2), currency)}`,
    };
  },

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

  gmailScanComplete: ({ candidates }) =>
    candidates > 0
      ? {
          title: '✨ Scan Gmail terminé',
          body: `${candidates} abonnement${candidates === 1 ? '' : 's'} potentiel${candidates === 1 ? '' : 's'} trouvé${candidates === 1 ? '' : 's'} dans votre boîte`,
        }
      : {
          title: 'Scan Gmail terminé',
          body: 'Aucun nouvel abonnement trouvé — tout ce que nous avons détecté est déjà dans votre liste',
        },

  subscriptionTrialEnding: ({ name, daysLeft }) => ({
    title: "L'essai se termine bientôt",
    body:
      daysLeft <= 1
        ? `Votre essai ${name} se termine demain — annulez maintenant pour éviter le prélèvement`
        : `Votre essai ${name} se termine dans ${daysLeft} jours`,
  }),

  proTrialExpiring: () => ({
    title: '⏰ Votre essai SubRadar se termine demain',
    body: 'Abonnez-vous maintenant pour garder un accès illimité à toutes les fonctionnalités',
  }),

  proTrialExpired: () => ({
    title: '🔓 Votre essai gratuit est terminé',
    body: 'Abonnez-vous à SubRadar Pro pour retrouver un accès illimité',
  }),
};
