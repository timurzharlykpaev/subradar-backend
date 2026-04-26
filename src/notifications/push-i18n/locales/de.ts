import { PushI18n } from '../types';

const fmtAmount = (a: number | string, c: string) => `${a} ${c}`;

export const de: PushI18n = {
  paymentReminder: ({ name, amount, currency, daysLeft, dateStr }) => ({
    title: `⏰ ${name} wird in ${daysLeft === 1 ? '1 Tag' : `${daysLeft} Tagen`} abgebucht`,
    body: `${fmtAmount(amount, currency)} · ${dateStr}`,
  }),

  trialExpiry: ({ daysLeft }) => ({
    title: `Deine Pro-Testphase endet in ${daysLeft === 1 ? '1 Tag' : `${daysLeft} Tagen`}`,
    body: 'Jetzt upgraden, um unbegrenzte Abos und AI-Funktionen zu behalten',
  }),

  proExpiration: ({ daysLeft }) => {
    if (daysLeft === 0) {
      return { title: 'SubRadar Pro', body: 'Deine Pro-Vorteile sind abgelaufen' };
    }
    if (daysLeft === 1) {
      return { title: 'SubRadar Pro', body: 'Letzter Pro-Tag!' };
    }
    return {
      title: 'SubRadar Pro',
      body: `Dein Pro-Abo endet in ${daysLeft} Tagen`,
    };
  },

  weeklyDigest: ({ currency, totalMonthly, activeCount, renewingThisWeek }) => ({
    title: `📊 ${totalMonthly.toFixed(0)} ${currency}/Mon. für ${activeCount} Abo${activeCount === 1 ? '' : 's'}`,
    body:
      renewingThisWeek > 0
        ? `${renewingThisWeek} verlänger${renewingThisWeek === 1 ? 't sich' : 'n sich'} diese Woche`
        : 'Deine wöchentliche Abo-Übersicht',
  }),

  winBack: ({ upcomingCount }) => ({
    title: '👀 Verpasse keine anstehenden Abbuchungen',
    body: `${upcomingCount} Abo${upcomingCount === 1 ? '' : 's'} verlänger${upcomingCount === 1 ? 't sich' : 'n sich'} diese Woche`,
  }),

  upcomingBilling: ({ subscriptionName, amount, currency, billingDate }) => ({
    title: '🔔 Anstehende Abbuchung',
    body: `${subscriptionName} wird am ${billingDate} mit ${fmtAmount(amount, currency)} belastet`,
  }),
};
