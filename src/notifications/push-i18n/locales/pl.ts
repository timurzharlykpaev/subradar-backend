import { PushI18n } from '../types';

const fmtAmount = (a: number | string, c: string) => `${c} ${a}`;

export const pl: PushI18n = {
  paymentReminder: ({ name, amount, currency, daysLeft, dateStr }) => ({
    title: `⏰ ${name} obciąży za ${daysLeft === 1 ? '1 dzień' : `${daysLeft} dni`}`,
    body: `${fmtAmount(amount, currency)} · ${dateStr}`,
  }),

  paymentRemindersDigest: ({ count, totalAmount, currency, earliestDays, topNames }) => {
    const when =
      earliestDays === 0 ? 'dziś' : earliestDays === 1 ? 'jutro' : `za ${earliestDays} dni`;
    const more = count > topNames.length ? `, +${count - topNames.length} więcej` : '';
    return {
      title: `⏰ ${count} ${count === 1 ? 'subskrypcja odnawia się' : 'subskrypcji odnawia się'} ${when}`,
      body: `${topNames.join(', ')}${more} · ${fmtAmount(totalAmount.toFixed(2), currency)}`,
    };
  },

  trialExpiry: ({ daysLeft }) => ({
    title: `Twoja próba Pro kończy się za ${daysLeft === 1 ? '1 dzień' : `${daysLeft} dni`}`,
    body: 'Ulepsz teraz, aby zachować nielimitowane subskrypcje i funkcje AI',
  }),

  proExpiration: ({ daysLeft }) => {
    if (daysLeft === 0) {
      return { title: 'SubRadar Pro', body: 'Twoje korzyści Pro zakończyły się' };
    }
    if (daysLeft === 1) {
      return { title: 'SubRadar Pro', body: 'Ostatni dzień Pro!' };
    }
    return {
      title: 'SubRadar Pro',
      body: `Twoja subskrypcja Pro kończy się za ${daysLeft} dni`,
    };
  },

  weeklyDigest: ({ currency, totalMonthly, activeCount, renewingThisWeek }) => ({
    title: `📊 ${currency} ${totalMonthly.toFixed(0)}/mies. na ${activeCount} ${activeCount === 1 ? 'subskrypcji' : 'subskrypcjach'}`,
    body:
      renewingThisWeek > 0
        ? `${renewingThisWeek} odnawia się w tym tygodniu`
        : 'Twoje tygodniowe podsumowanie subskrypcji',
  }),

  winBack: ({ upcomingCount }) => ({
    title: '👀 Nie przegap nadchodzących opłat',
    body: `${upcomingCount} ${upcomingCount === 1 ? 'subskrypcja odnawia się' : 'subskrypcji odnawia się'} w tym tygodniu`,
  }),

  gmailScanComplete: ({ candidates }) =>
    candidates > 0
      ? {
          title: '✨ Skanowanie Gmail gotowe',
          body: `Znaleziono ${candidates} ${candidates === 1 ? 'potencjalną subskrypcję' : 'potencjalnych subskrypcji'} w skrzynce`,
        }
      : {
          title: 'Skanowanie Gmail zakończone',
          body: 'Brak nowych subskrypcji — wszystko już jest na liście',
        },

  subscriptionTrialEnding: ({ name, daysLeft }) => ({
    title: 'Próba wkrótce się kończy',
    body:
      daysLeft <= 1
        ? `Twoja próba ${name} kończy się jutro — anuluj teraz, aby uniknąć opłat`
        : `Twoja próba ${name} kończy się za ${daysLeft} dni`,
  }),

  proTrialExpiring: () => ({
    title: '⏰ Twoja próba SubRadar kończy się jutro',
    body: 'Subskrybuj teraz, aby zachować nielimitowany dostęp do wszystkich funkcji',
  }),

  proTrialExpired: () => ({
    title: '🔓 Twoja darmowa próba zakończyła się',
    body: 'Subskrybuj SubRadar Pro, aby przywrócić nielimitowany dostęp',
  }),

  refundProcessed: () => ({
    title: 'Zwrot przetworzony',
    body: 'Twoja subskrypcja została zwrócona, a dostęp usunięty',
  }),
};
