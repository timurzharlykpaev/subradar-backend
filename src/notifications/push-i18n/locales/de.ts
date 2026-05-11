import { PushI18n } from '../types';

const fmtAmount = (a: number | string, c: string) => `${a} ${c}`;

export const de: PushI18n = {
  paymentReminder: ({ name, amount, currency, daysLeft, dateStr }) => ({
    title: `⏰ ${name} wird in ${daysLeft === 1 ? '1 Tag' : `${daysLeft} Tagen`} abgebucht`,
    body: `${fmtAmount(amount, currency)} · ${dateStr}`,
  }),

  paymentRemindersDigest: ({ count, totalAmount, currency, earliestDays, topNames }) => {
    const when =
      earliestDays === 0 ? 'heute' : earliestDays === 1 ? 'morgen' : `in ${earliestDays} Tagen`;
    const more = count > topNames.length ? `, +${count - topNames.length} weitere` : '';
    return {
      title: `⏰ ${count} Abonnement${count === 1 ? '' : 's'} fällig ${when}`,
      body: `${topNames.join(', ')}${more} · ${fmtAmount(totalAmount.toFixed(2), currency)}`,
    };
  },

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

  gmailScanComplete: ({ candidates }) =>
    candidates > 0
      ? {
          title: '✨ Gmail-Scan fertig',
          body: `${candidates} mögliche${candidates === 1 ? 's' : ''} Abonnement${candidates === 1 ? '' : 's'} in deinem Postfach gefunden`,
        }
      : {
          title: 'Gmail-Scan abgeschlossen',
          body: 'Keine neuen Abos gefunden — alles Erkannte steht bereits in deiner Liste',
        },

  subscriptionTrialEnding: ({ name, daysLeft }) => ({
    title: 'Testphase endet bald',
    body:
      daysLeft <= 1
        ? `Deine ${name}-Testphase endet morgen — jetzt kündigen, um Abbuchungen zu vermeiden`
        : `Deine ${name}-Testphase endet in ${daysLeft} Tagen`,
  }),

  proTrialExpiring: () => ({
    title: '⏰ Deine SubRadar-Testphase endet morgen',
    body: 'Jetzt abonnieren, um unbegrenzten Zugriff auf alle Funktionen zu behalten',
  }),

  proTrialExpired: () => ({
    title: '🔓 Deine kostenlose Testphase ist abgelaufen',
    body: 'Abonniere SubRadar Pro, um den unbegrenzten Zugriff wiederherzustellen',
  }),
};
