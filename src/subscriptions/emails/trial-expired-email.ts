/**
 * Localized HTML for the "your Pro trial has ended, you've been moved
 * back to Free" email sent by trial-checker.cron.downgradeExpiredTrials.
 *
 * Until this module existed the email was a 50-line Russian-only HTML
 * string inlined in the cron — every non-Russian user got a fully
 * Russian email regardless of their app locale. Localized push had
 * already been wired up via push-i18n; the email was the last
 * outgoing user-facing channel still pinned to a single language.
 *
 * 10 supported locales mirror push-i18n: en/ru/es/de/fr/pt/zh/ja/ko/kk.
 * Unknown locales fall back to English. The visual styling is kept
 * identical to the original (background + gradient + Pro/Free comparison
 * table + purple CTA pill) — only the strings change.
 */

type EmailLocale =
  | 'en'
  | 'ru'
  | 'es'
  | 'de'
  | 'fr'
  | 'pt'
  | 'zh'
  | 'ja'
  | 'ko'
  | 'kk';

interface EmailStrings {
  subject: string;
  preheader: string;
  title: string;
  body1: string;
  body2: string;
  freeLabel: string;
  freeValue: string;
  proLabel: string;
  proValue: string;
  cta: string;
}

const TEMPLATES: Record<EmailLocale, EmailStrings> = {
  en: {
    subject: '⏰ SubRadar: Your free trial has ended',
    preheader: 'Free trial ended',
    title: 'Your 7-day free trial has ended',
    body1: 'Your plan has been moved to <strong style="color:#fff;">Free</strong>.',
    body2:
      'Subscribe to <strong style="color:#8B5CF6;">SubRadar Pro</strong> to restore unlimited access.',
    freeLabel: 'Free plan',
    freeValue: '3 subscriptions, 5 AI requests',
    proLabel: 'Pro plan',
    proValue: '∞ subscriptions, 200 AI requests',
    cta: 'Subscribe →',
  },
  ru: {
    subject: '⏰ SubRadar: Пробный период завершён',
    preheader: 'Пробный период завершён',
    title: 'Ваш 7-дневный пробный период истёк',
    body1: 'Ваш план был переведён на <strong style="color:#fff;">Free</strong>.',
    body2:
      'Оформите подписку <strong style="color:#8B5CF6;">SubRadar Pro</strong> чтобы вернуть неограниченный доступ.',
    freeLabel: 'Free план',
    freeValue: '3 подписки, 5 AI запросов',
    proLabel: 'Pro план',
    proValue: '∞ подписок, 200 AI запросов',
    cta: 'Оформить подписку →',
  },
  es: {
    subject: '⏰ SubRadar: Tu prueba gratuita ha terminado',
    preheader: 'Prueba gratuita terminada',
    title: 'Tu prueba gratuita de 7 días ha terminado',
    body1:
      'Tu plan se ha movido a <strong style="color:#fff;">Free</strong>.',
    body2:
      'Suscríbete a <strong style="color:#8B5CF6;">SubRadar Pro</strong> para restaurar el acceso ilimitado.',
    freeLabel: 'Plan Free',
    freeValue: '3 suscripciones, 5 solicitudes AI',
    proLabel: 'Plan Pro',
    proValue: '∞ suscripciones, 200 solicitudes AI',
    cta: 'Suscribirse →',
  },
  de: {
    subject: '⏰ SubRadar: Deine kostenlose Testphase ist abgelaufen',
    preheader: 'Testphase beendet',
    title: 'Deine 7-tägige kostenlose Testphase ist abgelaufen',
    body1: 'Dein Plan wurde auf <strong style="color:#fff;">Free</strong> zurückgesetzt.',
    body2:
      'Abonniere <strong style="color:#8B5CF6;">SubRadar Pro</strong>, um den unbegrenzten Zugriff wiederherzustellen.',
    freeLabel: 'Free Plan',
    freeValue: '3 Abos, 5 AI-Anfragen',
    proLabel: 'Pro Plan',
    proValue: '∞ Abos, 200 AI-Anfragen',
    cta: 'Jetzt abonnieren →',
  },
  fr: {
    subject: '⏰ SubRadar : Votre essai gratuit est terminé',
    preheader: 'Essai gratuit terminé',
    title: 'Votre essai gratuit de 7 jours est terminé',
    body1: 'Votre plan est passé à <strong style="color:#fff;">Free</strong>.',
    body2:
      'Abonnez-vous à <strong style="color:#8B5CF6;">SubRadar Pro</strong> pour retrouver un accès illimité.',
    freeLabel: 'Plan Free',
    freeValue: '3 abonnements, 5 requêtes AI',
    proLabel: 'Plan Pro',
    proValue: '∞ abonnements, 200 requêtes AI',
    cta: "S'abonner →",
  },
  pt: {
    subject: '⏰ SubRadar: Seu teste gratuito terminou',
    preheader: 'Teste gratuito terminado',
    title: 'Seu teste gratuito de 7 dias terminou',
    body1: 'Seu plano foi movido para <strong style="color:#fff;">Free</strong>.',
    body2:
      'Assine o <strong style="color:#8B5CF6;">SubRadar Pro</strong> para restaurar o acesso ilimitado.',
    freeLabel: 'Plano Free',
    freeValue: '3 assinaturas, 5 solicitações AI',
    proLabel: 'Plano Pro',
    proValue: '∞ assinaturas, 200 solicitações AI',
    cta: 'Assinar →',
  },
  zh: {
    subject: '⏰ SubRadar：您的免费试用已结束',
    preheader: '免费试用已结束',
    title: '您的 7 天免费试用已结束',
    body1: '您的方案已切换为 <strong style="color:#fff;">Free</strong>。',
    body2:
      '订阅 <strong style="color:#8B5CF6;">SubRadar Pro</strong>，恢复无限制访问。',
    freeLabel: 'Free 方案',
    freeValue: '3 个订阅，5 次 AI 请求',
    proLabel: 'Pro 方案',
    proValue: '∞ 订阅，200 次 AI 请求',
    cta: '立即订阅 →',
  },
  ja: {
    subject: '⏰ SubRadar：無料トライアルが終了しました',
    preheader: '無料トライアル終了',
    title: '7 日間の無料トライアルが終了しました',
    body1:
      'あなたのプランは <strong style="color:#fff;">Free</strong> に変更されました。',
    body2:
      '<strong style="color:#8B5CF6;">SubRadar Pro</strong> に登録して、無制限アクセスを取り戻しましょう。',
    freeLabel: 'Free プラン',
    freeValue: 'サブスク 3 件、AI リクエスト 5 回',
    proLabel: 'Pro プラン',
    proValue: 'サブスク ∞、AI リクエスト 200 回',
    cta: '登録する →',
  },
  ko: {
    subject: '⏰ SubRadar: 무료 체험이 종료되었습니다',
    preheader: '무료 체험 종료',
    title: '7일 무료 체험이 종료되었습니다',
    body1:
      '플랜이 <strong style="color:#fff;">Free</strong>로 변경되었습니다.',
    body2:
      '<strong style="color:#8B5CF6;">SubRadar Pro</strong>를 구독하여 무제한 액세스를 복구하세요.',
    freeLabel: 'Free 플랜',
    freeValue: '구독 3개, AI 요청 5회',
    proLabel: 'Pro 플랜',
    proValue: '구독 ∞, AI 요청 200회',
    cta: '구독하기 →',
  },
  kk: {
    subject: '⏰ SubRadar: Тегін сынақ мерзіміңіз аяқталды',
    preheader: 'Сынақ мерзімі аяқталды',
    title: '7 күндік тегін сынақ мерзіміңіз аяқталды',
    body1:
      'Жоспарыңыз <strong style="color:#fff;">Free</strong>-ге ауыстырылды.',
    body2:
      'Шектеусіз қол жеткізуді қалпына келтіру үшін <strong style="color:#8B5CF6;">SubRadar Pro</strong>-ға жазылыңыз.',
    freeLabel: 'Free жоспары',
    freeValue: '3 жазылым, 5 AI сұранысы',
    proLabel: 'Pro жоспары',
    proValue: '∞ жазылым, 200 AI сұранысы',
    cta: 'Жазылу →',
  },
};

function resolveLocale(raw: string | null | undefined): EmailLocale {
  if (!raw) return 'en';
  const lang = raw.split(/[-_]/)[0].toLowerCase();
  return (Object.keys(TEMPLATES) as EmailLocale[]).includes(lang as EmailLocale)
    ? (lang as EmailLocale)
    : 'en';
}

/**
 * Build subject + HTML for the trial-expired email in the user's
 * locale. Falls back to English if the locale isn't one of the
 * supported 10.
 */
export function buildTrialExpiredEmail(
  locale: string | null | undefined,
): { subject: string; html: string } {
  const code = resolveLocale(locale);
  const t = TEMPLATES[code];
  const html = `
<!DOCTYPE html>
<html lang="${code}">
<head><meta charset="UTF-8"/></head>
<body style="margin:0;padding:0;background:#0f0f1a;font-family:'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0f0f1a;padding:40px 0;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;">
        <tr><td align="center" style="padding-bottom:32px;">
          <span style="font-size:28px;font-weight:800;color:#fff;letter-spacing:-0.5px;">
            Sub<span style="color:#8B5CF6;">Radar</span>
          </span>
        </td></tr>
        <tr><td style="background:linear-gradient(135deg,#1a1a2e,#16213e);border-radius:16px;border:1px solid rgba(139,92,246,0.3);padding:40px;">
          <p style="margin:0 0 8px;font-size:13px;color:#8B5CF6;text-transform:uppercase;letter-spacing:1px;font-weight:600;">${t.preheader}</p>
          <h1 style="margin:0 0 16px;font-size:22px;color:#fff;font-weight:700;">${t.title}</h1>
          <p style="margin:0 0 24px;color:#a0a0b8;font-size:15px;line-height:1.6;">
            ${t.body1}<br/>
            ${t.body2}
          </p>
          <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
            <tr><td style="background:rgba(139,92,246,0.1);border-radius:12px;border:1px solid rgba(139,92,246,0.2);padding:20px;">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="color:#a0a0b8;font-size:13px;padding-bottom:8px;">${t.freeLabel}</td>
                  <td align="right" style="color:#fff;font-size:13px;font-weight:600;padding-bottom:8px;">${t.freeValue}</td>
                </tr>
                <tr>
                  <td style="color:#a0a0b8;font-size:13px;">${t.proLabel}</td>
                  <td align="right" style="color:#8B5CF6;font-size:13px;font-weight:700;">${t.proValue}</td>
                </tr>
              </table>
            </td></tr>
          </table>
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr><td align="center">
              <a href="https://app.subradar.ai/paywall" style="display:inline-block;background:linear-gradient(135deg,#8B5CF6,#6D28D9);color:#fff;text-decoration:none;font-size:15px;font-weight:700;padding:14px 36px;border-radius:10px;">
                ${t.cta}
              </a>
            </td></tr>
          </table>
        </td></tr>
        <tr><td align="center" style="padding-top:24px;">
          <p style="margin:0;font-size:12px;color:#4a4a6a;">SubRadar AI · <a href="https://app.subradar.ai" style="color:#6D28D9;text-decoration:none;">app.subradar.ai</a></p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
  return { subject: t.subject, html };
}
