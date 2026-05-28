import { PushI18n } from '../types';

const fmtAmount = (a: number | string, c: string) => `${c} ${a}`;

export const it: PushI18n = {
  paymentReminder: ({ name, amount, currency, daysLeft, dateStr }) => ({
    title: `⏰ ${name} addebito tra ${daysLeft === 1 ? '1 giorno' : `${daysLeft} giorni`}`,
    body: `${fmtAmount(amount, currency)} · ${dateStr}`,
  }),

  paymentRemindersDigest: ({ count, totalAmount, currency, earliestDays, topNames }) => {
    const when =
      earliestDays === 0 ? 'oggi' : earliestDays === 1 ? 'domani' : `tra ${earliestDays} giorni`;
    const more = count > topNames.length ? `, +${count - topNames.length} altri` : '';
    return {
      title: `⏰ ${count} abbonament${count === 1 ? 'o' : 'i'} in rinnovo ${when}`,
      body: `${topNames.join(', ')}${more} · ${fmtAmount(totalAmount.toFixed(2), currency)}`,
    };
  },

  trialExpiry: ({ daysLeft }) => ({
    title: `La tua prova Pro termina tra ${daysLeft === 1 ? '1 giorno' : `${daysLeft} giorni`}`,
    body: 'Aggiorna ora per mantenere abbonamenti illimitati e funzioni AI',
  }),

  proExpiration: ({ daysLeft }) => {
    if (daysLeft === 0) {
      return { title: 'SubRadar Pro', body: 'I tuoi vantaggi Pro sono terminati' };
    }
    if (daysLeft === 1) {
      return { title: 'SubRadar Pro', body: 'Ultimo giorno di Pro!' };
    }
    return {
      title: 'SubRadar Pro',
      body: `Il tuo abbonamento Pro termina tra ${daysLeft} giorni`,
    };
  },

  weeklyDigest: ({ currency, totalMonthly, activeCount, renewingThisWeek }) => ({
    title: `📊 ${currency} ${totalMonthly.toFixed(0)}/mese su ${activeCount} abbonament${activeCount === 1 ? 'o' : 'i'}`,
    body:
      renewingThisWeek > 0
        ? `${renewingThisWeek} in rinnovo questa settimana`
        : 'Il tuo riepilogo settimanale degli abbonamenti',
  }),

  winBack: ({ upcomingCount }) => ({
    title: '👀 Non perdere i prossimi addebiti',
    body: `${upcomingCount} abbonament${upcomingCount === 1 ? 'o' : 'i'} in rinnovo questa settimana`,
  }),

  gmailScanComplete: ({ candidates }) =>
    candidates > 0
      ? {
          title: '✨ Scansione Gmail pronta',
          body: `Trovat${candidates === 1 ? 'o' : 'i'} ${candidates} abbonament${candidates === 1 ? 'o' : 'i'} potenzial${candidates === 1 ? 'e' : 'i'} nella tua casella`,
        }
      : {
          title: 'Scansione Gmail completata',
          body: 'Nessun nuovo abbonamento — tutto quello rilevato è già nella tua lista',
        },

  subscriptionTrialEnding: ({ name, daysLeft }) => ({
    title: 'Prova in scadenza',
    body:
      daysLeft <= 1
        ? `La tua prova ${name} termina domani — annulla ora per evitare addebiti`
        : `La tua prova ${name} termina tra ${daysLeft} giorni`,
  }),

  proTrialExpiring: () => ({
    title: '⏰ La tua prova SubRadar termina domani',
    body: 'Iscriviti ora per mantenere accesso illimitato a tutte le funzioni',
  }),

  proTrialExpired: () => ({
    title: '🔓 La tua prova gratuita è terminata',
    body: 'Iscriviti a SubRadar Pro per ripristinare l\'accesso illimitato',
  }),

  refundProcessed: () => ({
    title: 'Rimborso processato',
    body: 'Il tuo abbonamento è stato rimborsato e l\'accesso rimosso',
  }),
};
