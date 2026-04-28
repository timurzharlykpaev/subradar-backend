import { PushI18n } from '../types';

const fmtAmount = (a: number | string, c: string) => `${a} ${c}`;

export const pt: PushI18n = {
  paymentReminder: ({ name, amount, currency, daysLeft, dateStr }) => ({
    title: `⏰ ${name} será cobrado em ${daysLeft === 1 ? '1 dia' : `${daysLeft} dias`}`,
    body: `${fmtAmount(amount, currency)} · ${dateStr}`,
  }),

  paymentRemindersDigest: ({ count, totalAmount, currency, earliestDays, topNames }) => {
    const when =
      earliestDays === 0 ? 'hoje' : earliestDays === 1 ? 'amanhã' : `em ${earliestDays} dias`;
    const more = count > topNames.length ? `, +${count - topNames.length} mais` : '';
    return {
      title: `⏰ ${count} assinatura${count === 1 ? '' : 's'} ${when}`,
      body: `${topNames.join(', ')}${more} · ${fmtAmount(totalAmount.toFixed(2), currency)}`,
    };
  },

  trialExpiry: ({ daysLeft }) => ({
    title: `Seu teste Pro termina em ${daysLeft === 1 ? '1 dia' : `${daysLeft} dias`}`,
    body: 'Assine agora para manter assinaturas ilimitadas e recursos de AI',
  }),

  proExpiration: ({ daysLeft }) => {
    if (daysLeft === 0) {
      return { title: 'SubRadar Pro', body: 'Seus benefícios Pro acabaram' };
    }
    if (daysLeft === 1) {
      return { title: 'SubRadar Pro', body: 'Último dia do Pro!' };
    }
    return {
      title: 'SubRadar Pro',
      body: `Sua assinatura Pro termina em ${daysLeft} dias`,
    };
  },

  weeklyDigest: ({ currency, totalMonthly, activeCount, renewingThisWeek }) => ({
    title: `📊 ${totalMonthly.toFixed(0)} ${currency}/mês em ${activeCount} assinatura${activeCount === 1 ? '' : 's'}`,
    body:
      renewingThisWeek > 0
        ? `${renewingThisWeek} renovação${renewingThisWeek === 1 ? '' : 'es'} esta semana`
        : 'Seu resumo semanal de assinaturas',
  }),

  winBack: ({ upcomingCount }) => ({
    title: '👀 Não perca as próximas cobranças',
    body: `${upcomingCount} assinatura${upcomingCount === 1 ? '' : 's'} renovando esta semana`,
  }),

  upcomingBilling: ({ subscriptionName, amount, currency, billingDate }) => ({
    title: '🔔 Cobrança a caminho',
    body: `${subscriptionName} será cobrado ${fmtAmount(amount, currency)} em ${billingDate}`,
  }),
};
