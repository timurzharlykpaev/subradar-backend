import { PushI18n } from '../types';

const fmtAmount = (a: number | string, c: string) => `${c} ${a}`;

export const ar: PushI18n = {
  paymentReminder: ({ name, amount, currency, daysLeft, dateStr }) => ({
    title: `⏰ سيتم تحصيل ${name} خلال ${daysLeft === 1 ? 'يوم واحد' : `${daysLeft} أيام`}`,
    body: `${fmtAmount(amount, currency)} · ${dateStr}`,
  }),

  paymentRemindersDigest: ({ count, totalAmount, currency, earliestDays, topNames }) => {
    const when =
      earliestDays === 0 ? 'اليوم' : earliestDays === 1 ? 'غدًا' : `خلال ${earliestDays} أيام`;
    const more = count > topNames.length ? `، +${count - topNames.length} المزيد` : '';
    return {
      title: `⏰ ${count} ${count === 1 ? 'اشتراك يتجدد' : 'اشتراكات تتجدد'} ${when}`,
      body: `${topNames.join('، ')}${more} · ${fmtAmount(totalAmount.toFixed(2), currency)}`,
    };
  },

  trialExpiry: ({ daysLeft }) => ({
    title: `تنتهي تجربة Pro الخاصة بك خلال ${daysLeft === 1 ? 'يوم واحد' : `${daysLeft} أيام`}`,
    body: 'ترقَّ الآن للاحتفاظ بالاشتراكات غير المحدودة وميزات الذكاء الاصطناعي',
  }),

  proExpiration: ({ daysLeft }) => {
    if (daysLeft === 0) {
      return { title: 'SubRadar Pro', body: 'انتهت مزايا Pro الخاصة بك' };
    }
    if (daysLeft === 1) {
      return { title: 'SubRadar Pro', body: 'آخر يوم من Pro!' };
    }
    return {
      title: 'SubRadar Pro',
      body: `ينتهي اشتراك Pro الخاص بك خلال ${daysLeft} أيام`,
    };
  },

  weeklyDigest: ({ currency, totalMonthly, activeCount, renewingThisWeek }) => ({
    title: `📊 ${currency} ${totalMonthly.toFixed(0)}/شهر على ${activeCount} ${activeCount === 1 ? 'اشتراك' : 'اشتراكات'}`,
    body:
      renewingThisWeek > 0
        ? `${renewingThisWeek} يتجدد هذا الأسبوع`
        : 'ملخصك الأسبوعي للاشتراكات',
  }),

  winBack: ({ upcomingCount }) => ({
    title: '👀 لا تفوّت الرسوم القادمة',
    body: `${upcomingCount} ${upcomingCount === 1 ? 'اشتراك يتجدد' : 'اشتراكات تتجدد'} هذا الأسبوع`,
  }),

  gmailScanComplete: ({ candidates }) =>
    candidates > 0
      ? {
          title: '✨ فحص Gmail جاهز',
          body: `تم العثور على ${candidates} ${candidates === 1 ? 'اشتراك محتمل' : 'اشتراكات محتملة'} في بريدك الوارد`,
        }
      : {
          title: 'انتهى فحص Gmail',
          body: 'لم يتم العثور على اشتراكات جديدة — كل ما اكتشفناه موجود بالفعل في قائمتك',
        },

  subscriptionTrialEnding: ({ name, daysLeft }) => ({
    title: 'التجربة تنتهي قريبًا',
    body:
      daysLeft <= 1
        ? `تنتهي تجربة ${name} الخاصة بك غدًا — ألغِ الآن لتجنب الرسوم`
        : `تنتهي تجربة ${name} الخاصة بك خلال ${daysLeft} أيام`,
  }),

  proTrialExpiring: () => ({
    title: '⏰ تنتهي تجربة SubRadar الخاصة بك غدًا',
    body: 'اشترك الآن للاحتفاظ بالوصول غير المحدود إلى كل الميزات',
  }),

  proTrialExpired: () => ({
    title: '🔓 انتهت تجربتك المجانية',
    body: 'اشترك في SubRadar Pro لاستعادة الوصول غير المحدود',
  }),

  refundProcessed: () => ({
    title: 'تمت معالجة الاسترداد',
    body: 'تم استرداد اشتراكك وإزالة الوصول',
  }),
};
