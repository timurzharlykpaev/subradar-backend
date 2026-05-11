import { PushI18n } from '../types';

const fmtAmount = (a: number | string, c: string) => `${a} ${c}`;

export const es: PushI18n = {
  paymentReminder: ({ name, amount, currency, daysLeft, dateStr }) => ({
    title: `⏰ ${name} se cobra en ${daysLeft === 1 ? '1 día' : `${daysLeft} días`}`,
    body: `${fmtAmount(amount, currency)} · ${dateStr}`,
  }),

  paymentRemindersDigest: ({ count, totalAmount, currency, earliestDays, topNames }) => {
    const when =
      earliestDays === 0 ? 'hoy' : earliestDays === 1 ? 'mañana' : `en ${earliestDays} días`;
    const more = count > topNames.length ? `, +${count - topNames.length} más` : '';
    return {
      title: `⏰ ${count} suscripcion${count === 1 ? '' : 'es'} se renueva${count === 1 ? '' : 'n'} ${when}`,
      body: `${topNames.join(', ')}${more} · ${fmtAmount(totalAmount.toFixed(2), currency)}`,
    };
  },

  trialExpiry: ({ daysLeft }) => ({
    title: `Tu prueba Pro termina en ${daysLeft === 1 ? '1 día' : `${daysLeft} días`}`,
    body: 'Suscríbete ahora para mantener suscripciones ilimitadas y funciones AI',
  }),

  proExpiration: ({ daysLeft }) => {
    if (daysLeft === 0) {
      return { title: 'SubRadar Pro', body: 'Tus beneficios Pro han terminado' };
    }
    if (daysLeft === 1) {
      return { title: 'SubRadar Pro', body: '¡Último día de Pro!' };
    }
    return {
      title: 'SubRadar Pro',
      body: `Tu suscripción Pro termina en ${daysLeft} días`,
    };
  },

  weeklyDigest: ({ currency, totalMonthly, activeCount, renewingThisWeek }) => ({
    title: `📊 ${totalMonthly.toFixed(0)} ${currency}/mes en ${activeCount} suscripción${activeCount === 1 ? '' : 'es'}`,
    body:
      renewingThisWeek > 0
        ? `${renewingThisWeek} se renueva${renewingThisWeek === 1 ? '' : 'n'} esta semana`
        : 'Tu resumen semanal de suscripciones',
  }),

  winBack: ({ upcomingCount }) => ({
    title: '👀 No te pierdas los próximos cobros',
    body: `${upcomingCount} suscripción${upcomingCount === 1 ? '' : 'es'} se renueva${upcomingCount === 1 ? '' : 'n'} esta semana`,
  }),

  gmailScanComplete: ({ candidates }) =>
    candidates > 0
      ? {
          title: '✨ Escaneo de Gmail listo',
          body: `Encontradas ${candidates} suscripción${candidates === 1 ? '' : 'es'} potencial${candidates === 1 ? '' : 'es'} en tu bandeja`,
        }
      : {
          title: 'Escaneo de Gmail terminado',
          body: 'No se encontraron nuevas suscripciones — todo lo detectado ya está en tu lista',
        },

  subscriptionTrialEnding: ({ name, daysLeft }) => ({
    title: 'La prueba termina pronto',
    body:
      daysLeft <= 1
        ? `Tu prueba de ${name} termina mañana — cancela ahora para evitar cargos`
        : `Tu prueba de ${name} termina en ${daysLeft} días`,
  }),

  proTrialExpiring: () => ({
    title: '⏰ Tu prueba de SubRadar termina mañana',
    body: 'Suscríbete ahora para mantener acceso ilimitado a todas las funciones',
  }),

  proTrialExpired: () => ({
    title: '🔓 Tu prueba gratuita ha terminado',
    body: 'Suscríbete a SubRadar Pro para recuperar el acceso ilimitado',
  }),
};
