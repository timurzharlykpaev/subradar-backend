import { PushI18n } from '../types';

const fmtAmount = (a: number | string, c: string) => `${a} ${c}`;

export const kk: PushI18n = {
  paymentReminder: ({ name, amount, currency, daysLeft, dateStr }) => ({
    title: `⏰ ${name} ${daysLeft} күннен кейін есептен шығады`,
    body: `${fmtAmount(amount, currency)} · ${dateStr}`,
  }),

  paymentRemindersDigest: ({ count, totalAmount, currency, earliestDays, topNames }) => {
    const when =
      earliestDays === 0
        ? 'бүгін'
        : earliestDays === 1
          ? 'ертең'
          : `${earliestDays} күннен кейін`;
    const more = count > topNames.length ? `, тағы ${count - topNames.length}` : '';
    return {
      title: `⏰ ${when} ${count} жазылым жаңарады`,
      body: `${topNames.join(', ')}${more} · ${fmtAmount(totalAmount.toFixed(2), currency)}`,
    };
  },

  trialExpiry: ({ daysLeft }) => ({
    title: `Pro сынақ мерзімі ${daysLeft} күннен кейін аяқталады`,
    body: 'Шектеусіз жазылымдар мен AI функцияларын сақтау үшін жаңартыңыз',
  }),

  proExpiration: ({ daysLeft }) => {
    if (daysLeft === 0) {
      return { title: 'SubRadar Pro', body: 'Pro артықшылықтары аяқталды' };
    }
    if (daysLeft === 1) {
      return { title: 'SubRadar Pro', body: 'Pro-ның соңғы күні!' };
    }
    return {
      title: 'SubRadar Pro',
      body: `Pro жазылымы ${daysLeft} күннен кейін аяқталады`,
    };
  },

  weeklyDigest: ({ currency, totalMonthly, activeCount, renewingThisWeek }) => ({
    title: `📊 ${currency} ${totalMonthly.toFixed(0)}/айына, ${activeCount} жазылым`,
    body:
      renewingThisWeek > 0
        ? `Осы аптада ${renewingThisWeek} жазылым жаңарады`
        : 'Апталық жазылым қорытындысы',
  }),

  winBack: ({ upcomingCount }) => ({
    title: '👀 Алдағы есептен шығаруларды өткізіп алмаңыз',
    body: `Осы аптада ${upcomingCount} жазылым жаңарады`,
  }),

  upcomingBilling: ({ subscriptionName, amount, currency, billingDate }) => ({
    title: '🔔 Жақын арадағы есептен шығару',
    body: `${subscriptionName} ${billingDate} күні ${fmtAmount(amount, currency)} есептен шығады`,
  }),
};
