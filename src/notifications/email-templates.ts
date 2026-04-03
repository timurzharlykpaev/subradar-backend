/**
 * SubRadar email templates
 * All templates use table-based layout for max email client compatibility.
 * Deep link: https://app.subradar.ai (web) / subradar:// (mobile — hardcoded for now)
 */

const APP_URL = 'https://app.subradar.ai';
// Mobile deep link (hardcoded until dynamic branch links are set up)
const MOBILE_URL = 'https://app.subradar.ai';

// ─── i18n strings ────────────────────────────────────────────────────────────

interface I18nStrings {
  greeting: (name: string) => string;
  reportTitle: (month: string) => string;
  reportSubtitle: string;
  totalLabel: string;
  activeCount: (n: number) => string;
  topSubs: string;
  perMonth: string;
  ctaText: string;
  proTitle: string;
  proDesc: string;
  proCtaText: string;
  unsubscribe: string;
  footerTagline: string;
  paymentReminderLabel: string;
  chargesIn: (days: number) => string;
  subscriptionLabel: string;
  amountLabel: string;
  dateLabel: string;
  openApp: string;
}

const STRINGS: Record<string, I18nStrings> = {
  ru: {
    greeting: (name: string) => `Привет, ${name} 👋`,
    reportTitle: (month: string) => `Отчёт за ${month}`,
    reportSubtitle: 'Вот как прошёл твой месяц подписок',
    totalLabel: 'ВСЕГО ПОТРАЧЕНО В МЕСЯЦ',
    activeCount: (n: number) => `${n} ${n === 1 ? 'активная подписка' : n < 5 ? 'активных подписки' : 'активных подписок'}`,
    topSubs: '💳 Топ подписки',
    perMonth: '/мес',
    ctaText: 'Открыть SubRadar →',
    proTitle: '⚡ SubRadar Pro',
    proDesc: 'Прогноз расходов · AI автодобавление · Умные напоминания',
    proCtaText: 'Попробовать Pro бесплатно →',
    unsubscribe: 'Отписаться от уведомлений',
    footerTagline: 'Управляй подписками умнее с SubRadar AI',
    paymentReminderLabel: 'НАПОМИНАНИЕ О ПЛАТЕЖЕ',
    chargesIn: (days: number) => days === 1 ? 'спишется через день' : `спишется через ${days} ${days < 5 ? 'дня' : 'дней'}`,
    subscriptionLabel: 'Подписка',
    amountLabel: 'Сумма',
    dateLabel: 'Дата списания',
    openApp: 'Открыть SubRadar →',
  },
  en: {
    greeting: (name: string) => `Hey, ${name} 👋`,
    reportTitle: (month: string) => `Report for ${month}`,
    reportSubtitle: "Here's how your subscriptions went this month",
    totalLabel: 'TOTAL SPENT THIS MONTH',
    activeCount: (n: number) => `${n} active ${n === 1 ? 'subscription' : 'subscriptions'}`,
    topSubs: '💳 Top subscriptions',
    perMonth: '/mo',
    ctaText: 'Open SubRadar →',
    proTitle: '⚡ SubRadar Pro',
    proDesc: 'Spending forecast · AI auto-add · Smart reminders',
    proCtaText: 'Try Pro for free →',
    unsubscribe: 'Unsubscribe from notifications',
    footerTagline: 'Manage your subscriptions smarter with SubRadar AI',
    paymentReminderLabel: 'PAYMENT REMINDER',
    chargesIn: (days: number) => days === 1 ? 'charges tomorrow' : `charges in ${days} days`,
    subscriptionLabel: 'Subscription',
    amountLabel: 'Amount',
    dateLabel: 'Billing date',
    openApp: 'Open SubRadar →',
  },
};

function t(locale: string): I18nStrings {
  const lang = (locale ?? 'en').split('-')[0].toLowerCase();
  return STRINGS[lang] ?? STRINGS.en;
}

// ─── Shared layout wrappers ───────────────────────────────────────────────────

function wrap(content: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1.0"/>
  <meta name="color-scheme" content="dark"/>
  <!--[if mso]><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml><![endif]-->
</head>
<body style="margin:0;padding:0;background-color:#0a0a16;-webkit-text-size-adjust:100%;mso-line-height-rule:exactly;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#0a0a16;padding:32px 0;">
    <tr>
      <td align="center" style="padding:0 16px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">
          <!-- LOGO -->
          <tr>
            <td align="center" style="padding-bottom:28px;">
              <a href="${APP_URL}" style="text-decoration:none;">
                <span style="font-size:26px;font-weight:900;color:#ffffff;letter-spacing:-0.5px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
                  Sub<span style="color:#8B5CF6;">Radar</span>
                </span>
              </a>
            </td>
          </tr>
          ${content}
          <!-- FOOTER -->
          <tr>
            <td align="center" style="padding-top:24px;">
              <p style="margin:0;font-size:12px;color:#374151;line-height:1.6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
                SubRadar AI&nbsp;·&nbsp;
                <a href="${APP_URL}/app/settings?tab=notifications" style="color:#6D28D9;text-decoration:none;">Unsubscribe</a>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

// ─── Monthly Report ───────────────────────────────────────────────────────────

export function buildMonthlyReportHtml(
  name: string,
  month: string,
  total: number,
  currency: string,
  topSubs: Array<{ name: string; monthly: number }>,
  count: number,
  locale = 'ru',
): string {
  const s = t(locale);
  const fmt = (n: number) => {
    const safe = isNaN(n) || !isFinite(n) ? 0 : n;
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: currency || 'USD',
      maximumFractionDigits: 2,
    }).format(safe);
  };

  const safeTotal = isNaN(total) || !isFinite(total) ? 0 : total;

  const topRows = topSubs
    .map(
      (s2, i) => `
      <tr>
        <td style="padding:10px 0;border-bottom:1px solid #1e1e3a;color:#9ca3af;font-size:14px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
          ${i + 1}.&nbsp;${s2.name}
        </td>
        <td align="right" style="padding:10px 0;border-bottom:1px solid #1e1e3a;font-weight:700;color:#e5e7eb;font-size:14px;white-space:nowrap;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
          ${fmt(s2.monthly)}${s.perMonth}
        </td>
      </tr>`,
    )
    .join('');

  const content = `
  <!-- HEADER CARD -->
  <tr>
    <td style="background:linear-gradient(135deg,#1a1a2e 0%,#16213e 100%);border-radius:16px;border:1px solid rgba(139,92,246,0.25);padding:28px;margin-bottom:16px;">
      <p style="color:#9ca3af;font-size:14px;margin:0 0 6px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">${s.greeting(name)}</p>
      <h1 style="color:#fff;font-size:22px;font-weight:800;margin:0 0 4px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">${s.reportTitle(month)}</h1>
      <p style="color:#6b7280;font-size:14px;margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">${s.reportSubtitle}</p>
    </td>
  </tr>
  <tr><td style="height:12px;"></td></tr>

  <!-- TOTAL CARD -->
  <tr>
    <td style="background:linear-gradient(135deg,rgba(139,92,246,0.2) 0%,rgba(109,40,217,0.15) 100%);border:1px solid rgba(139,92,246,0.35);border-radius:16px;padding:28px;text-align:center;">
      <p style="color:#c4b5fd;font-size:12px;text-transform:uppercase;letter-spacing:1.5px;margin:0 0 10px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">${s.totalLabel}</p>
      <p style="color:#fff;font-size:42px;font-weight:900;margin:0 0 6px;line-height:1;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">${fmt(safeTotal)}</p>
      <p style="color:#9ca3af;font-size:13px;margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">${s.activeCount(count)}</p>
    </td>
  </tr>
  <tr><td style="height:12px;"></td></tr>

  <!-- TOP SUBS -->
  <tr>
    <td style="background:#111128;border:1px solid #1e1e3a;border-radius:16px;padding:24px;">
      <p style="color:#e5e7eb;font-size:15px;font-weight:700;margin:0 0 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">${s.topSubs}</p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
        ${topRows}
      </table>
    </td>
  </tr>
  <tr><td style="height:12px;"></td></tr>

  <!-- CTA -->
  <tr>
    <td style="background:#111128;border:1px solid #1e1e3a;border-radius:16px;padding:24px;text-align:center;">
      <p style="color:#9ca3af;font-size:14px;margin:0 0 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">${s.proDesc}</p>
      <a href="${APP_URL}" style="display:inline-block;background:linear-gradient(135deg,#7c3aed,#6d28d9);color:#fff;text-decoration:none;padding:14px 32px;border-radius:12px;font-weight:700;font-size:15px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
        ${s.ctaText}
      </a>
    </td>
  </tr>`;

  return wrap(content);
}

// ─── Weekly Digest ───────────────────────────────────────────────────────────

export function buildWeeklyDigestHtml(
  name: string,
  summary: string,
  totalMonthlySavings: number,
  currency: string,
  activeCount: number,
  totalMonthly: number,
  recommendations: Array<{ priority: string; title: string; description: string; estimatedSavingsMonthly: number }>,
  locale = 'ru',
  appUrl = 'https://app.subradar.ai',
): string {
  const isRu = (locale ?? 'ru').split('-')[0].toLowerCase() === 'ru';

  const fmt = (n: number) => {
    const safe = isNaN(n) || !isFinite(n) ? 0 : n;
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: currency || 'USD',
      maximumFractionDigits: 2,
    }).format(safe);
  };

  const safeSavings = isNaN(totalMonthlySavings) || !isFinite(totalMonthlySavings) ? 0 : totalMonthlySavings;
  const safeTotal = isNaN(totalMonthly) || !isFinite(totalMonthly) ? 0 : totalMonthly;

  const priorityIcon = (p: string) => {
    if (p === 'HIGH') return '🔴';
    if (p === 'MEDIUM') return '🟡';
    return '🟢';
  };

  const recRows = recommendations
    .slice(0, 5)
    .map(
      (rec) => `
      <tr>
        <td style="padding:12px 0;border-bottom:1px solid #1e1e3a;vertical-align:top;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td style="width:28px;font-size:16px;vertical-align:top;padding-top:2px;">${priorityIcon(rec.priority)}</td>
              <td style="padding-left:8px;">
                <p style="margin:0 0 4px;color:#e5e7eb;font-size:14px;font-weight:600;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">${rec.title}</p>
                <p style="margin:0;color:#9ca3af;font-size:13px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">${rec.description}</p>
              </td>
              <td align="right" style="white-space:nowrap;padding-left:12px;vertical-align:top;">
                <p style="margin:0;color:#34d399;font-size:13px;font-weight:700;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
                  ${isRu ? '−' : '−'}${fmt(rec.estimatedSavingsMonthly)}${isRu ? '/мес' : '/mo'}
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>`,
    )
    .join('');

  const content = `
  <!-- HEADER CARD -->
  <tr>
    <td style="background:linear-gradient(135deg,#1a1a2e 0%,#16213e 100%);border-radius:16px;border:1px solid rgba(139,92,246,0.25);padding:28px;margin-bottom:16px;">
      <p style="color:#9ca3af;font-size:14px;margin:0 0 6px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
        ${isRu ? `Привет, ${name} 👋` : `Hey, ${name} 👋`}
      </p>
      <h1 style="color:#fff;font-size:22px;font-weight:800;margin:0 0 4px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
        ${isRu ? '📊 Ваш еженедельный дайджест' : '📊 Your Weekly Digest'}
      </h1>
      <p style="color:#6b7280;font-size:14px;margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
        ${isRu ? 'AI-анализ ваших подписок' : 'AI analysis of your subscriptions'}
      </p>
    </td>
  </tr>
  <tr><td style="height:12px;"></td></tr>

  <!-- STATS GRID -->
  <tr>
    <td>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td width="32%" style="background:#111128;border:1px solid #1e1e3a;border-radius:12px;padding:20px;text-align:center;">
            <p style="color:#9ca3af;font-size:11px;text-transform:uppercase;letter-spacing:1px;margin:0 0 8px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
              ${isRu ? 'Активных' : 'Active'}
            </p>
            <p style="color:#fff;font-size:28px;font-weight:900;margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">${activeCount}</p>
          </td>
          <td width="4%"></td>
          <td width="32%" style="background:#111128;border:1px solid #1e1e3a;border-radius:12px;padding:20px;text-align:center;">
            <p style="color:#9ca3af;font-size:11px;text-transform:uppercase;letter-spacing:1px;margin:0 0 8px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
              ${isRu ? 'В месяц' : 'Monthly'}
            </p>
            <p style="color:#fff;font-size:20px;font-weight:900;margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">${fmt(safeTotal)}</p>
          </td>
          <td width="4%"></td>
          <td width="32%" style="background:linear-gradient(135deg,rgba(52,211,153,0.15) 0%,rgba(16,185,129,0.1) 100%);border:1px solid rgba(52,211,153,0.3);border-radius:12px;padding:20px;text-align:center;">
            <p style="color:#6ee7b7;font-size:11px;text-transform:uppercase;letter-spacing:1px;margin:0 0 8px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
              ${isRu ? 'Экономия' : 'Savings'}
            </p>
            <p style="color:#34d399;font-size:20px;font-weight:900;margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">${fmt(safeSavings)}</p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
  <tr><td style="height:12px;"></td></tr>

  <!-- AI SUMMARY -->
  <tr>
    <td style="background:#111128;border:1px solid #1e1e3a;border-radius:16px;padding:24px;">
      <p style="color:#8B5CF6;font-size:12px;text-transform:uppercase;letter-spacing:1.5px;font-weight:700;margin:0 0 10px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
        ✨ ${isRu ? 'AI-резюме' : 'AI Summary'}
      </p>
      <p style="color:#d1d5db;font-size:14px;line-height:1.7;margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">${summary}</p>
    </td>
  </tr>
  <tr><td style="height:12px;"></td></tr>

  ${recRows ? `
  <!-- RECOMMENDATIONS -->
  <tr>
    <td style="background:#111128;border:1px solid #1e1e3a;border-radius:16px;padding:24px;">
      <p style="color:#e5e7eb;font-size:15px;font-weight:700;margin:0 0 4px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
        💡 ${isRu ? 'Рекомендации' : 'Recommendations'}
      </p>
      <p style="color:#6b7280;font-size:13px;margin:0 0 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
        🔴 ${isRu ? 'высокий' : 'high'} &nbsp;🟡 ${isRu ? 'средний' : 'medium'} &nbsp;🟢 ${isRu ? 'низкий приоритет' : 'low priority'}
      </p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
        ${recRows}
      </table>
    </td>
  </tr>
  <tr><td style="height:12px;"></td></tr>
  ` : ''}

  <!-- CTA -->
  <tr>
    <td style="background:linear-gradient(135deg,rgba(139,92,246,0.2) 0%,rgba(109,40,217,0.15) 100%);border:1px solid rgba(139,92,246,0.35);border-radius:16px;padding:28px;text-align:center;">
      <p style="color:#c4b5fd;font-size:14px;margin:0 0 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
        ${isRu ? 'Полный анализ и детальные рекомендации — в приложении' : 'Full analysis and detailed recommendations — in the app'}
      </p>
      <a href="${appUrl}/analytics" style="display:inline-block;background:linear-gradient(135deg,#7c3aed,#6d28d9);color:#fff;text-decoration:none;padding:14px 32px;border-radius:12px;font-weight:700;font-size:15px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
        ${isRu ? 'Открыть аналитику →' : 'Open analytics →'}
      </a>
    </td>
  </tr>
  <tr><td style="height:8px;"></td></tr>

  <!-- UNSUBSCRIBE -->
  <tr>
    <td align="center" style="padding:8px 0;">
      <p style="margin:0;font-size:12px;color:#4b5563;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
        <a href="${appUrl}/settings?tab=notifications" style="color:#6D28D9;text-decoration:none;">
          ${isRu ? 'Отписаться от дайджеста' : 'Unsubscribe from digest'}
        </a>
      </p>
    </td>
  </tr>`;

  return wrap(content);
}

// ─── Payment Reminder ─────────────────────────────────────────────────────────

export function buildPaymentReminderHtml(
  name: string,
  subName: string,
  amount: number,
  currency: string,
  daysLeft: number,
  date: string,
  locale = 'ru',
): string {
  const s = t(locale);
  const safeAmount = isNaN(amount) || !isFinite(amount) ? 0 : amount;
  const fmtAmount = new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: currency || 'USD',
    maximumFractionDigits: 2,
  }).format(safeAmount);

  const content = `
  <!-- REMINDER CARD -->
  <tr>
    <td style="background:linear-gradient(135deg,#1a1a2e 0%,#16213e 100%);border-radius:16px;border:1px solid rgba(139,92,246,0.3);padding:36px;">
      <!-- Label -->
      <p style="margin:0 0 10px;font-size:12px;color:#8B5CF6;text-transform:uppercase;letter-spacing:1.5px;font-weight:700;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
        ${s.paymentReminderLabel}
      </p>
      <!-- Title -->
      <h1 style="margin:0 0 28px;font-size:22px;color:#ffffff;font-weight:800;line-height:1.3;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
        ⏰&nbsp;<strong>${subName}</strong>&nbsp;<span style="color:#8B5CF6;">${s.chargesIn(daysLeft)}</span>
      </h1>
      <!-- Info block -->
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
        <tr>
          <td style="background:rgba(139,92,246,0.12);border-radius:12px;border:1px solid rgba(139,92,246,0.25);padding:20px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td style="color:#a0a0b8;font-size:13px;padding-bottom:14px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">${s.subscriptionLabel}</td>
                <td align="right" style="color:#ffffff;font-size:13px;font-weight:600;padding-bottom:14px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">${subName}</td>
              </tr>
              <tr>
                <td style="color:#a0a0b8;font-size:13px;padding-bottom:14px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">${s.amountLabel}</td>
                <td align="right" style="color:#8B5CF6;font-size:20px;font-weight:800;padding-bottom:14px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">${fmtAmount}</td>
              </tr>
              <tr>
                <td style="color:#a0a0b8;font-size:13px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">${s.dateLabel}</td>
                <td align="right" style="color:#ffffff;font-size:13px;font-weight:600;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">${date}</td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
      <!-- CTA -->
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td align="center">
            <a href="${MOBILE_URL}" style="display:inline-block;background:linear-gradient(135deg,#8B5CF6,#6D28D9);color:#ffffff;text-decoration:none;font-size:15px;font-weight:700;padding:15px 40px;border-radius:12px;letter-spacing:0.3px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
              ${s.openApp}
            </a>
          </td>
        </tr>
      </table>
    </td>
  </tr>`;

  return wrap(content);
}
