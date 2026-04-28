import { PushI18n } from '../types';

const fmtAmount = (a: number | string, c: string) => `${c} ${a}`;

export const en: PushI18n = {
  paymentReminder: ({ name, amount, currency, daysLeft, dateStr }) => ({
    title: `⏰ ${name} charges in ${daysLeft === 1 ? '1 day' : `${daysLeft} days`}`,
    body: `${fmtAmount(amount, currency)} · ${dateStr}`,
  }),

  paymentRemindersDigest: ({ count, totalAmount, currency, earliestDays, topNames }) => {
    const when =
      earliestDays === 0 ? 'today' : earliestDays === 1 ? 'tomorrow' : `in ${earliestDays} days`;
    const more = count > topNames.length ? `, +${count - topNames.length} more` : '';
    return {
      title: `⏰ ${count} subscription${count === 1 ? '' : 's'} renewing ${when}`,
      body: `${topNames.join(', ')}${more} · ${fmtAmount(totalAmount.toFixed(2), currency)}`,
    };
  },

  trialExpiry: ({ daysLeft }) => ({
    title: `Your Pro trial ends in ${daysLeft === 1 ? '1 day' : `${daysLeft} days`}`,
    body: 'Upgrade now to keep unlimited subscriptions and AI features',
  }),

  proExpiration: ({ daysLeft }) => {
    if (daysLeft === 0) {
      return { title: 'SubRadar Pro', body: 'Your Pro benefits have ended' };
    }
    if (daysLeft === 1) {
      return { title: 'SubRadar Pro', body: 'Last day of Pro!' };
    }
    return {
      title: 'SubRadar Pro',
      body: `Your Pro subscription ends in ${daysLeft} days`,
    };
  },

  weeklyDigest: ({ currency, totalMonthly, activeCount, renewingThisWeek }) => ({
    title: `📊 ${currency} ${totalMonthly.toFixed(0)}/mo on ${activeCount} subscription${activeCount === 1 ? '' : 's'}`,
    body:
      renewingThisWeek > 0
        ? `${renewingThisWeek} renewing this week`
        : 'Your weekly subscription summary',
  }),

  winBack: ({ upcomingCount }) => ({
    title: "👀 Don't miss upcoming charges",
    body: `${upcomingCount} subscription${upcomingCount === 1 ? '' : 's'} renewing this week`,
  }),

  upcomingBilling: ({ subscriptionName, amount, currency, billingDate }) => ({
    title: '🔔 Upcoming Billing',
    body: `${subscriptionName} will be charged ${fmtAmount(amount, currency)} on ${billingDate}`,
  }),
};
