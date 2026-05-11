import { PushI18n } from '../types';

const pluralRu = (n: number, one: string, few: string, many: string) => {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
};

const fmtAmount = (a: number | string, c: string) => `${a} ${c}`;

export const ru: PushI18n = {
  paymentReminder: ({ name, amount, currency, daysLeft, dateStr }) => ({
    title: `⏰ ${name} спишется через ${daysLeft} ${pluralRu(daysLeft, 'день', 'дня', 'дней')}`,
    body: `${fmtAmount(amount, currency)} · ${dateStr}`,
  }),

  paymentRemindersDigest: ({ count, totalAmount, currency, earliestDays, topNames }) => {
    const when =
      earliestDays === 0
        ? 'сегодня'
        : earliestDays === 1
          ? 'завтра'
          : `через ${earliestDays} ${pluralRu(earliestDays, 'день', 'дня', 'дней')}`;
    const subsWord = pluralRu(count, 'подписка спишется', 'подписки спишутся', 'подписок спишутся');
    const more = count > topNames.length ? `, +${count - topNames.length} ещё` : '';
    return {
      title: `⏰ ${count} ${subsWord} ${when}`,
      body: `${topNames.join(', ')}${more} · ${fmtAmount(totalAmount.toFixed(2), currency)}`,
    };
  },

  trialExpiry: ({ daysLeft }) => ({
    title: `Ваш Pro-триал заканчивается через ${daysLeft} ${pluralRu(daysLeft, 'день', 'дня', 'дней')}`,
    body: 'Оформите подписку, чтобы сохранить безлимит и AI-функции',
  }),

  proExpiration: ({ daysLeft }) => {
    if (daysLeft === 0) {
      return { title: 'SubRadar Pro', body: 'Ваши Pro-преимущества закончились' };
    }
    if (daysLeft === 1) {
      return { title: 'SubRadar Pro', body: 'Последний день Pro!' };
    }
    return {
      title: 'SubRadar Pro',
      body: `Ваша Pro-подписка заканчивается через ${daysLeft} ${pluralRu(daysLeft, 'день', 'дня', 'дней')}`,
    };
  },

  weeklyDigest: ({ currency, totalMonthly, activeCount, renewingThisWeek }) => ({
    title: `📊 ${currency} ${totalMonthly.toFixed(0)}/мес на ${activeCount} ${pluralRu(activeCount, 'подписку', 'подписки', 'подписок')}`,
    body:
      renewingThisWeek > 0
        ? `${renewingThisWeek} ${pluralRu(renewingThisWeek, 'продлевается', 'продлеваются', 'продлеваются')} на этой неделе`
        : 'Ваша еженедельная сводка по подпискам',
  }),

  winBack: ({ upcomingCount }) => ({
    title: '👀 Не пропустите грядущие списания',
    body: `${upcomingCount} ${pluralRu(upcomingCount, 'подписка продлевается', 'подписки продлеваются', 'подписок продлеваются')} на этой неделе`,
  }),

  gmailScanComplete: ({ candidates }) =>
    candidates > 0
      ? {
          title: '✨ Сканирование Gmail готово',
          body: `Найдено ${candidates} ${pluralRu(candidates, 'возможная подписка', 'возможные подписки', 'возможных подписок')} в вашем ящике`,
        }
      : {
          title: 'Сканирование Gmail завершено',
          body: 'Новых подписок не найдено — всё, что мы обнаружили, уже в вашем списке',
        },

  subscriptionTrialEnding: ({ name, daysLeft }) => ({
    title: 'Триал скоро закончится',
    body:
      daysLeft <= 1
        ? `Триал ${name} заканчивается завтра — отмените, чтобы не списали оплату`
        : `Триал ${name} заканчивается через ${daysLeft} ${pluralRu(daysLeft, 'день', 'дня', 'дней')}`,
  }),

  proTrialExpiring: () => ({
    title: '⏰ Ваш триал SubRadar заканчивается завтра',
    body: 'Оформите подписку, чтобы сохранить безлимитный доступ ко всем функциям',
  }),

  proTrialExpired: () => ({
    title: '🔓 Ваш бесплатный триал завершён',
    body: 'Оформите SubRadar Pro, чтобы вернуть безлимитный доступ',
  }),
};
