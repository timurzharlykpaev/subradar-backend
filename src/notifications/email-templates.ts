/**
 * SubRadar email templates
 * All templates use table-based layout for max email client compatibility.
 * Deep link: https://app.subradar.ai (web) / subradar:// (mobile — hardcoded for now)
 */

const APP_URL = 'https://app.subradar.ai';
// Mobile deep link (hardcoded until dynamic branch links are set up)
const MOBILE_URL = 'https://app.subradar.ai';

// CAN-SPAM compliance: physical postal address required in every commercial
// email. Goalin LLP is the legal entity behind SubRadar.
const COMPANY_FOOTER_ADDRESS = 'Goalin LLP · Astana, Kazakhstan';

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
  es: {
    greeting: (name: string) => `Hola, ${name} 👋`,
    reportTitle: (month: string) => `Informe de ${month}`,
    reportSubtitle: 'Así fue tu mes de suscripciones',
    totalLabel: 'TOTAL DEL MES',
    activeCount: (n: number) => `${n} suscripcion${n === 1 ? '' : 'es'} activa${n === 1 ? '' : 's'}`,
    topSubs: '💳 Suscripciones principales',
    perMonth: '/mes',
    ctaText: 'Abrir SubRadar →',
    proTitle: '⚡ SubRadar Pro',
    proDesc: 'Previsión de gastos · AI auto-añadir · Recordatorios inteligentes',
    proCtaText: 'Prueba Pro gratis →',
    unsubscribe: 'Cancelar suscripción a notificaciones',
    footerTagline: 'Gestiona tus suscripciones de forma más inteligente con SubRadar AI',
    paymentReminderLabel: 'RECORDATORIO DE PAGO',
    chargesIn: (days: number) => days === 1 ? 'se cobra mañana' : `se cobra en ${days} días`,
    subscriptionLabel: 'Suscripción',
    amountLabel: 'Importe',
    dateLabel: 'Fecha de cobro',
    openApp: 'Abrir SubRadar →',
  },
  de: {
    greeting: (name: string) => `Hallo ${name} 👋`,
    reportTitle: (month: string) => `Bericht für ${month}`,
    reportSubtitle: 'So lief dein Abo-Monat',
    totalLabel: 'GESAMTAUSGABEN PRO MONAT',
    activeCount: (n: number) => `${n} aktive${n === 1 ? 's' : ''} Abonnement${n === 1 ? '' : 's'}`,
    topSubs: '💳 Top-Abos',
    perMonth: '/Mon.',
    ctaText: 'SubRadar öffnen →',
    proTitle: '⚡ SubRadar Pro',
    proDesc: 'Ausgabenprognose · AI auto-hinzufügen · Smarte Erinnerungen',
    proCtaText: 'Pro kostenlos testen →',
    unsubscribe: 'Benachrichtigungen abbestellen',
    footerTagline: 'Abos smarter verwalten mit SubRadar AI',
    paymentReminderLabel: 'ZAHLUNGSERINNERUNG',
    chargesIn: (days: number) => days === 1 ? 'morgen fällig' : `in ${days} Tagen fällig`,
    subscriptionLabel: 'Abonnement',
    amountLabel: 'Betrag',
    dateLabel: 'Abbuchungsdatum',
    openApp: 'SubRadar öffnen →',
  },
  fr: {
    greeting: (name: string) => `Salut ${name} 👋`,
    reportTitle: (month: string) => `Rapport de ${month}`,
    reportSubtitle: "Voici votre mois d'abonnements",
    totalLabel: 'DÉPENSES TOTALES DU MOIS',
    activeCount: (n: number) => `${n} abonnement${n === 1 ? '' : 's'} actif${n === 1 ? '' : 's'}`,
    topSubs: '💳 Top abonnements',
    perMonth: '/mois',
    ctaText: 'Ouvrir SubRadar →',
    proTitle: '⚡ SubRadar Pro',
    proDesc: 'Prévisions · IA auto-ajout · Rappels intelligents',
    proCtaText: 'Essayer Pro gratuitement →',
    unsubscribe: 'Se désabonner des notifications',
    footerTagline: 'Gérez vos abonnements plus intelligemment avec SubRadar AI',
    paymentReminderLabel: 'RAPPEL DE PAIEMENT',
    chargesIn: (days: number) => days === 1 ? 'prélevé demain' : `prélevé dans ${days} jours`,
    subscriptionLabel: 'Abonnement',
    amountLabel: 'Montant',
    dateLabel: 'Date de prélèvement',
    openApp: 'Ouvrir SubRadar →',
  },
  pt: {
    greeting: (name: string) => `Olá, ${name} 👋`,
    reportTitle: (month: string) => `Relatório de ${month}`,
    reportSubtitle: 'Veja como foi seu mês de assinaturas',
    totalLabel: 'TOTAL DO MÊS',
    activeCount: (n: number) => `${n} assinatura${n === 1 ? '' : 's'} ativa${n === 1 ? '' : 's'}`,
    topSubs: '💳 Principais assinaturas',
    perMonth: '/mês',
    ctaText: 'Abrir SubRadar →',
    proTitle: '⚡ SubRadar Pro',
    proDesc: 'Previsão de gastos · IA auto-adicionar · Lembretes inteligentes',
    proCtaText: 'Experimente Pro grátis →',
    unsubscribe: 'Cancelar assinatura das notificações',
    footerTagline: 'Gerencie suas assinaturas de forma inteligente com SubRadar AI',
    paymentReminderLabel: 'LEMBRETE DE PAGAMENTO',
    chargesIn: (days: number) => days === 1 ? 'cobrança amanhã' : `cobrança em ${days} dias`,
    subscriptionLabel: 'Assinatura',
    amountLabel: 'Valor',
    dateLabel: 'Data da cobrança',
    openApp: 'Abrir SubRadar →',
  },
  zh: {
    greeting: (name: string) => `你好，${name} 👋`,
    reportTitle: (month: string) => `${month} 报告`,
    reportSubtitle: '这是您本月的订阅情况',
    totalLabel: '本月总支出',
    activeCount: (n: number) => `${n} 个有效订阅`,
    topSubs: '💳 主要订阅',
    perMonth: '/月',
    ctaText: '打开 SubRadar →',
    proTitle: '⚡ SubRadar Pro',
    proDesc: '支出预测 · AI 自动添加 · 智能提醒',
    proCtaText: '免费试用 Pro →',
    unsubscribe: '取消订阅通知',
    footerTagline: '使用 SubRadar AI 更智能地管理订阅',
    paymentReminderLabel: '付款提醒',
    chargesIn: (days: number) => days === 1 ? '明天扣款' : `${days} 天后扣款`,
    subscriptionLabel: '订阅',
    amountLabel: '金额',
    dateLabel: '扣款日期',
    openApp: '打开 SubRadar →',
  },
  ja: {
    greeting: (name: string) => `こんにちは、${name}さん 👋`,
    reportTitle: (month: string) => `${month}のレポート`,
    reportSubtitle: '今月のサブスクリプション概要',
    totalLabel: '今月の合計支出',
    activeCount: (n: number) => `アクティブなサブスク ${n} 件`,
    topSubs: '💳 主なサブスク',
    perMonth: '/月',
    ctaText: 'SubRadar を開く →',
    proTitle: '⚡ SubRadar Pro',
    proDesc: '支出予測 · AI 自動追加 · スマートリマインダー',
    proCtaText: 'Pro を無料で試す →',
    unsubscribe: '通知を停止',
    footerTagline: 'SubRadar AI でサブスクをスマートに管理',
    paymentReminderLabel: '支払いリマインダー',
    chargesIn: (days: number) => days === 1 ? '明日請求' : `${days}日後に請求`,
    subscriptionLabel: 'サブスクリプション',
    amountLabel: '金額',
    dateLabel: '請求日',
    openApp: 'SubRadar を開く →',
  },
  ko: {
    greeting: (name: string) => `안녕하세요, ${name}님 👋`,
    reportTitle: (month: string) => `${month} 리포트`,
    reportSubtitle: '이번 달 구독 요약입니다',
    totalLabel: '이번 달 총 지출',
    activeCount: (n: number) => `활성 구독 ${n}개`,
    topSubs: '💳 주요 구독',
    perMonth: '/월',
    ctaText: 'SubRadar 열기 →',
    proTitle: '⚡ SubRadar Pro',
    proDesc: '지출 예측 · AI 자동 추가 · 스마트 알림',
    proCtaText: 'Pro 무료 체험 →',
    unsubscribe: '알림 구독 취소',
    footerTagline: 'SubRadar AI로 구독을 더 똑똑하게 관리하세요',
    paymentReminderLabel: '결제 알림',
    chargesIn: (days: number) => days === 1 ? '내일 결제' : `${days}일 후 결제`,
    subscriptionLabel: '구독',
    amountLabel: '금액',
    dateLabel: '결제일',
    openApp: 'SubRadar 열기 →',
  },
  kk: {
    greeting: (name: string) => `Сәлем, ${name} 👋`,
    reportTitle: (month: string) => `${month} есебі`,
    reportSubtitle: 'Жазылымдарыңыздың айлық жиынтығы',
    totalLabel: 'АЙЛЫҚ ЖАЛПЫ ШЫҒЫН',
    activeCount: (n: number) => `${n} белсенді жазылым`,
    topSubs: '💳 Негізгі жазылымдар',
    perMonth: '/айына',
    ctaText: 'SubRadar ашу →',
    proTitle: '⚡ SubRadar Pro',
    proDesc: 'Шығын болжамы · AI авто-қосу · Ақылды еске салу',
    proCtaText: 'Pro-ны тегін көру →',
    unsubscribe: 'Хабарламалардан бас тарту',
    footerTagline: 'SubRadar AI-мен жазылымдарды ақылды басқарыңыз',
    paymentReminderLabel: 'ТӨЛЕМ ЕСКЕРТУ',
    chargesIn: (days: number) => days === 1 ? 'ертең есептен шығады' : `${days} күннен кейін есептен шығады`,
    subscriptionLabel: 'Жазылым',
    amountLabel: 'Сома',
    dateLabel: 'Есептен шығару күні',
    openApp: 'SubRadar ашу →',
  },
};

function t(locale: string): I18nStrings {
  const lang = (locale ?? 'en').split('-')[0].toLowerCase();
  return STRINGS[lang] ?? STRINGS.en;
}

const MONTHLY_REPORT_SUBJECT: Record<string, (month: string) => string> = {
  ru: (m) => `📊 Ваш отчёт SubRadar за ${m}`,
  en: (m) => `📊 Your SubRadar report for ${m}`,
  es: (m) => `📊 Tu informe de SubRadar de ${m}`,
  de: (m) => `📊 Dein SubRadar Bericht für ${m}`,
  fr: (m) => `📊 Votre rapport SubRadar de ${m}`,
  pt: (m) => `📊 Seu relatório SubRadar de ${m}`,
  zh: (m) => `📊 您的 SubRadar ${m} 报告`,
  ja: (m) => `📊 ${m} の SubRadar レポート`,
  ko: (m) => `📊 ${m} SubRadar 리포트`,
  kk: (m) => `📊 ${m} SubRadar есебі`,
};

/** Localized subject line for the monthly spending report email. */
export function monthlyReportSubject(locale: string, month: string): string {
  const lang = (locale ?? 'en').split('-')[0].toLowerCase();
  return (MONTHLY_REPORT_SUBJECT[lang] ?? MONTHLY_REPORT_SUBJECT.en)(month);
}

/** Localized subject line for the daily reminders digest email. */
export function dailyDigestSubject(locale: string, count: number): string {
  const lang = (locale ?? 'en').split('-')[0].toLowerCase();
  const s = DIGEST_STRINGS[lang] ?? DIGEST_STRINGS.en;
  return `⏰ ${s.heading(count)}`;
}

// ─── Auth emails (magic link + OTP) ──────────────────────────────────────────

interface AuthStrings {
  magicSubject: string;
  magicHeading: string;
  magicBody: string;
  magicCta: string;
  otpSubject: string;
  otpHeading: string;
  otpBody: string;
  ignoreNote: string;
}

const AUTH_STRINGS: Record<string, AuthStrings> = {
  en: {
    magicSubject: 'Your SubRadar sign-in link',
    magicHeading: 'Sign in to SubRadar',
    magicBody: 'Click the button below to sign in. This link expires in 15 minutes.',
    magicCta: 'Sign in to SubRadar',
    otpSubject: 'Your SubRadar verification code',
    otpHeading: 'Your verification code',
    otpBody: 'Enter this code to sign in to SubRadar. It expires in 15 minutes.',
    ignoreNote: "If you didn't request this, ignore this email.",
  },
  ru: {
    magicSubject: 'Ссылка для входа в SubRadar',
    magicHeading: 'Войдите в SubRadar',
    magicBody: 'Нажмите кнопку ниже, чтобы войти. Ссылка действует 15 минут.',
    magicCta: 'Войти в SubRadar',
    otpSubject: 'Ваш код подтверждения SubRadar',
    otpHeading: 'Ваш код подтверждения',
    otpBody: 'Введите код, чтобы войти в SubRadar. Срок действия — 15 минут.',
    ignoreNote: 'Если вы не запрашивали это письмо, просто проигнорируйте его.',
  },
  es: {
    magicSubject: 'Tu enlace para iniciar sesión en SubRadar',
    magicHeading: 'Iniciar sesión en SubRadar',
    magicBody: 'Haz clic en el botón para iniciar sesión. El enlace expira en 15 minutos.',
    magicCta: 'Iniciar sesión',
    otpSubject: 'Tu código de verificación SubRadar',
    otpHeading: 'Tu código de verificación',
    otpBody: 'Introduce este código para iniciar sesión. Expira en 15 minutos.',
    ignoreNote: 'Si no solicitaste esto, ignora este correo.',
  },
  de: {
    magicSubject: 'Dein SubRadar-Anmeldelink',
    magicHeading: 'Bei SubRadar anmelden',
    magicBody: 'Klicke auf den Button, um dich anzumelden. Der Link läuft in 15 Minuten ab.',
    magicCta: 'Bei SubRadar anmelden',
    otpSubject: 'Dein SubRadar Bestätigungscode',
    otpHeading: 'Dein Bestätigungscode',
    otpBody: 'Gib diesen Code ein, um dich anzumelden. Er läuft in 15 Minuten ab.',
    ignoreNote: 'Wenn du das nicht angefordert hast, ignoriere diese E-Mail.',
  },
  fr: {
    magicSubject: 'Votre lien de connexion SubRadar',
    magicHeading: 'Se connecter à SubRadar',
    magicBody: 'Cliquez sur le bouton ci-dessous pour vous connecter. Le lien expire dans 15 minutes.',
    magicCta: 'Se connecter à SubRadar',
    otpSubject: 'Votre code de vérification SubRadar',
    otpHeading: 'Votre code de vérification',
    otpBody: 'Saisissez ce code pour vous connecter. Il expire dans 15 minutes.',
    ignoreNote: "Si vous n'êtes pas à l'origine de cette demande, ignorez cet email.",
  },
  pt: {
    magicSubject: 'Seu link de acesso ao SubRadar',
    magicHeading: 'Entrar no SubRadar',
    magicBody: 'Clique no botão abaixo para entrar. O link expira em 15 minutos.',
    magicCta: 'Entrar no SubRadar',
    otpSubject: 'Seu código de verificação SubRadar',
    otpHeading: 'Seu código de verificação',
    otpBody: 'Digite este código para entrar. Ele expira em 15 minutos.',
    ignoreNote: 'Se você não solicitou, ignore este email.',
  },
  zh: {
    magicSubject: '您的 SubRadar 登录链接',
    magicHeading: '登录 SubRadar',
    magicBody: '点击下方按钮登录。链接 15 分钟后过期。',
    magicCta: '登录 SubRadar',
    otpSubject: '您的 SubRadar 验证码',
    otpHeading: '您的验证码',
    otpBody: '输入此验证码以登录 SubRadar。15 分钟后过期。',
    ignoreNote: '如果不是您操作的，请忽略此邮件。',
  },
  ja: {
    magicSubject: 'SubRadar サインインリンク',
    magicHeading: 'SubRadar にサインイン',
    magicBody: '下のボタンをタップしてサインインしてください。リンクは 15 分後に失効します。',
    magicCta: 'SubRadar にサインイン',
    otpSubject: 'SubRadar 認証コード',
    otpHeading: '認証コード',
    otpBody: 'このコードを入力してサインインしてください。15 分後に失効します。',
    ignoreNote: '心当たりがない場合は、このメールを無視してください。',
  },
  ko: {
    magicSubject: 'SubRadar 로그인 링크',
    magicHeading: 'SubRadar에 로그인',
    magicBody: '아래 버튼을 눌러 로그인하세요. 링크는 15분 후 만료됩니다.',
    magicCta: 'SubRadar에 로그인',
    otpSubject: 'SubRadar 인증 코드',
    otpHeading: '인증 코드',
    otpBody: '이 코드를 입력하여 SubRadar에 로그인하세요. 15분 후 만료됩니다.',
    ignoreNote: '본인이 요청하지 않았다면 이 이메일을 무시하세요.',
  },
  kk: {
    magicSubject: 'SubRadar кіру сілтемесі',
    magicHeading: 'SubRadar-ға кіру',
    magicBody: 'Кіру үшін төмендегі түймені басыңыз. Сілтеме 15 минуттан кейін жарамсыз болады.',
    magicCta: 'SubRadar-ға кіру',
    otpSubject: 'SubRadar растау коды',
    otpHeading: 'Растау коды',
    otpBody: 'SubRadar-ға кіру үшін осы кодты енгізіңіз. 15 минуттан кейін жарамсыз болады.',
    ignoreNote: 'Сіз сұрамасаңыз, бұл хатты елемеңіз.',
  },
};

function authT(locale: string): AuthStrings {
  const lang = (locale ?? 'en').split('-')[0].toLowerCase();
  return AUTH_STRINGS[lang] ?? AUTH_STRINGS.en;
}

/** Localized magic link email. */
export function buildMagicLinkEmail(opts: {
  locale: string;
  link: string;
}): { subject: string; html: string } {
  const s = authT(opts.locale);
  const html = `
    <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px">
      <h2 style="margin-bottom:8px">${s.magicHeading}</h2>
      <p style="color:#666;margin-bottom:24px">${s.magicBody}</p>
      <a href="${opts.link}" style="display:inline-block;background:#8B5CF6;color:#fff;text-decoration:none;padding:14px 28px;border-radius:12px;font-weight:600">
        ${s.magicCta}
      </a>
      <p style="color:#999;font-size:12px;margin-top:24px">${s.ignoreNote}</p>
    </div>
  `;
  return { subject: s.magicSubject, html };
}

/** Localized OTP email. */
export function buildOtpEmail(opts: {
  locale: string;
  code: string;
}): { subject: string; html: string } {
  const s = authT(opts.locale);
  const html = `
    <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px">
      <h2 style="margin-bottom:8px">${s.otpHeading}</h2>
      <p style="color:#666;margin-bottom:24px">${s.otpBody}</p>
      <div style="background:#f4f0ff;border-radius:12px;padding:20px;text-align:center;font-size:32px;font-weight:700;letter-spacing:8px;color:#8B5CF6;">
        ${opts.code}
      </div>
      <p style="color:#999;font-size:12px;margin-top:24px">${s.ignoreNote}</p>
    </div>
  `;
  return { subject: s.otpSubject, html };
}

// ─── Shared layout wrappers ───────────────────────────────────────────────────

/**
 * Wrap arbitrary inner content in the SubRadar email shell.
 *
 * @param content   Raw `<tr>...</tr>` rows that go between header and footer.
 * @param opts.unsubscribeUrl   HMAC-signed one-click unsub URL (preferred). When omitted
 *                              we fall back to a deep-link to in-app settings — safe for
 *                              transactional mail (magic links etc.) but NOT for any
 *                              recurring email, which must always supply a real link.
 * @param opts.preheader        Hidden preview text shown by Gmail/Apple Mail in the
 *                              inbox list. Keep it under ~110 chars.
 */
function wrap(
  content: string,
  opts: { unsubscribeUrl?: string | null; preheader?: string } = {},
): string {
  const unsubHref =
    opts.unsubscribeUrl || `${APP_URL}/app/settings?tab=notifications`;
  const preheader = opts.preheader
    ? `<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:#0a0a16;opacity:0;">${opts.preheader}</div>`
    : '';
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1.0"/>
  <meta name="color-scheme" content="dark"/>
  <!--[if mso]><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml><![endif]-->
</head>
<body style="margin:0;padding:0;background-color:#0a0a16;-webkit-text-size-adjust:100%;mso-line-height-rule:exactly;">
  ${preheader}
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
          <!-- FOOTER (CAN-SPAM compliant: address + unsubscribe) -->
          <tr>
            <td align="center" style="padding-top:24px;">
              <p style="margin:0 0 6px;font-size:12px;color:#4b5563;line-height:1.6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
                ${COMPANY_FOOTER_ADDRESS}
              </p>
              <p style="margin:0;font-size:12px;color:#374151;line-height:1.6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
                <a href="${unsubHref}" style="color:#6D28D9;text-decoration:underline;">Unsubscribe</a>
                &nbsp;·&nbsp;
                <a href="${APP_URL}/legal/privacy" style="color:#6D28D9;text-decoration:none;">Privacy</a>
                &nbsp;·&nbsp;
                <a href="${APP_URL}/legal/terms" style="color:#6D28D9;text-decoration:none;">Terms</a>
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

  const preheader = locale.startsWith('ru')
    ? `Отчёт за ${month}: ${fmt(safeTotal)} на ${count} подписках`
    : `${month} report: ${fmt(safeTotal)} across ${count} subscriptions`;
  return wrap(content, { preheader });
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
  unsubscribeUrl: string | null = null,
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

  <!-- UNSUBSCRIBE (one-click, token-based) -->
  <tr>
    <td align="center" style="padding:8px 0;">
      <p style="margin:0;font-size:12px;color:#4b5563;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
        <a href="${unsubscribeUrl ?? `${appUrl}/settings?tab=notifications`}" style="color:#6D28D9;text-decoration:none;">
          ${isRu ? 'Отписаться от дайджеста' : 'Unsubscribe from digest'}
        </a>
      </p>
    </td>
  </tr>`;

  const preheader = isRu
    ? `Сэкономьте ${fmt(safeSavings)}/мес на ${activeCount} подписках`
    : `Save ${fmt(safeSavings)}/mo across ${activeCount} subscriptions`;
  return wrap(content, { unsubscribeUrl, preheader });
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
  unsubscribeUrl: string | null = null,
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

  const preheader = locale.startsWith('ru')
    ? `${subName} спишется через ${daysLeft === 1 ? '1 день' : `${daysLeft} дн.`} — ${fmtAmount}`
    : `${subName} renews in ${daysLeft === 1 ? '1 day' : `${daysLeft} days`} — ${fmtAmount}`;

  return wrap(content, { unsubscribeUrl, preheader });
}

// ─── Pro Expiration (7 days before) ──────────────────────────────────────────

const PRO_EXPIRATION_STRINGS: Record<
  string,
  { subject: string; heading: string; greeting: (n: string) => string; body: string; cta: string; signoff: string }
> = {
  ru: {
    subject: 'Ваша подписка SubRadar Pro заканчивается через 7 дней',
    heading: 'Ваша Pro-подписка скоро закончится',
    greeting: (n: string) => `Привет${n ? `, ${n}` : ''},`,
    body: 'Ваша подписка SubRadar Pro закончится через 7 дней. После этого вы потеряете доступ к безлимиту подписок и AI-функциям.',
    cta: 'Продлить подписку',
    signoff: '— Команда SubRadar',
  },
  en: {
    subject: 'Your SubRadar Pro subscription ends in 7 days',
    heading: 'Your Pro subscription is ending soon',
    greeting: (n: string) => `Hi${n ? ` ${n}` : ''},`,
    body: "Your SubRadar Pro subscription will end in 7 days. After that you'll lose access to unlimited subscriptions and AI features.",
    cta: 'Renew your subscription',
    signoff: '— SubRadar Team',
  },
  es: {
    subject: 'Tu suscripción SubRadar Pro termina en 7 días',
    heading: 'Tu suscripción Pro termina pronto',
    greeting: (n: string) => `Hola${n ? ` ${n}` : ''},`,
    body: 'Tu suscripción SubRadar Pro terminará en 7 días. Después perderás el acceso a suscripciones ilimitadas y funciones AI.',
    cta: 'Renovar suscripción',
    signoff: '— Equipo SubRadar',
  },
  de: {
    subject: 'Dein SubRadar Pro endet in 7 Tagen',
    heading: 'Deine Pro-Mitgliedschaft endet bald',
    greeting: (n: string) => `Hallo${n ? ` ${n}` : ''},`,
    body: 'Deine SubRadar Pro Mitgliedschaft endet in 7 Tagen. Danach verlierst du den Zugriff auf unbegrenzte Abos und AI-Funktionen.',
    cta: 'Abo verlängern',
    signoff: '— Das SubRadar Team',
  },
  fr: {
    subject: 'Votre abonnement SubRadar Pro se termine dans 7 jours',
    heading: 'Votre abonnement Pro se termine bientôt',
    greeting: (n: string) => `Bonjour${n ? ` ${n}` : ''},`,
    body: 'Votre abonnement SubRadar Pro se termine dans 7 jours. Vous perdrez ensuite l’accès aux abonnements illimités et aux fonctions AI.',
    cta: "Renouveler l'abonnement",
    signoff: '— Équipe SubRadar',
  },
  pt: {
    subject: 'Sua assinatura SubRadar Pro termina em 7 dias',
    heading: 'Sua assinatura Pro está terminando',
    greeting: (n: string) => `Olá${n ? ` ${n}` : ''},`,
    body: 'Sua assinatura SubRadar Pro terminará em 7 dias. Após isso você perderá acesso a assinaturas ilimitadas e recursos de IA.',
    cta: 'Renovar assinatura',
    signoff: '— Equipe SubRadar',
  },
  zh: {
    subject: '您的 SubRadar Pro 订阅将在 7 天后结束',
    heading: '您的 Pro 订阅即将到期',
    greeting: (n: string) => `${n ? `${n}，` : ''}您好,`,
    body: '您的 SubRadar Pro 订阅将在 7 天后结束。之后您将无法使用无限订阅和 AI 功能。',
    cta: '续订订阅',
    signoff: '— SubRadar 团队',
  },
  ja: {
    subject: 'SubRadar Pro は 7 日後に終了します',
    heading: 'Pro サブスクリプションが終了します',
    greeting: (n: string) => `${n ? `${n} 様、` : ''}こんにちは,`,
    body: 'SubRadar Pro サブスクリプションは 7 日後に終了します。終了後は無制限サブスクリプションと AI 機能をご利用いただけません。',
    cta: 'サブスクリプションを更新',
    signoff: '— SubRadar チーム',
  },
  ko: {
    subject: 'SubRadar Pro 구독이 7일 후 종료됩니다',
    heading: 'Pro 구독이 곧 종료됩니다',
    greeting: (n: string) => `${n ? `${n}님, ` : ''}안녕하세요,`,
    body: 'SubRadar Pro 구독이 7일 후 종료됩니다. 종료 후에는 무제한 구독 및 AI 기능을 사용할 수 없습니다.',
    cta: '구독 갱신',
    signoff: '— SubRadar 팀',
  },
  kk: {
    subject: 'SubRadar Pro жазылымы 7 күннен кейін аяқталады',
    heading: 'Pro жазылымыңыз жақын арада аяқталады',
    greeting: (n: string) => `Сәлем${n ? `, ${n}` : ''},`,
    body: 'SubRadar Pro жазылымыңыз 7 күннен кейін аяқталады. Содан кейін шектеусіз жазылымдар мен AI функцияларына қол жеткізе алмайсыз.',
    cta: 'Жазылымды жаңарту',
    signoff: '— SubRadar командасы',
  },
};

/**
 * 7-day Pro expiration warning email. Localized via PRO_EXPIRATION_STRINGS;
 * other locales currently fall back to English (parity with the rest of the
 * email pipeline pending the full 10-locale rollout).
 */
export function buildProExpirationEmail(opts: {
  locale: string;
  name: string | null;
}): { subject: string; html: string } {
  const lang = (opts.locale ?? 'en').split('-')[0].toLowerCase();
  const s = PRO_EXPIRATION_STRINGS[lang] ?? PRO_EXPIRATION_STRINGS.en;
  const name = (opts.name ?? '').trim();
  const html = `
    <h2>${s.heading}</h2>
    <p>${s.greeting(name)}</p>
    <p>${s.body}</p>
    <p><a href="${APP_URL}">${s.cta}</a></p>
    <p>${s.signoff}</p>
  `;
  return { subject: s.subject, html };
}

// ─── Daily digest (multiple subs in one email) ───────────────────────────────

const DIGEST_STRINGS: Record<
  string,
  {
    heading: (n: number) => string;
    intro: string;
    totalLabel: string;
    chargesIn: (days: number) => string;
    todayLabel: string;
    cta: string;
  }
> = {
  ru: {
    heading: (n) =>
      `${n} ${n === 1 ? 'подписка спишется' : n < 5 ? 'подписки спишутся' : 'подписок спишутся'} скоро`,
    intro: 'Вот что нужно проверить:',
    totalLabel: 'ИТОГО',
    chargesIn: (d) =>
      d === 0 ? 'сегодня' : d === 1 ? 'через 1 день' : `через ${d} ${d < 5 ? 'дня' : 'дней'}`,
    todayLabel: 'сегодня',
    cta: 'Открыть SubRadar',
  },
  en: {
    heading: (n) => `${n} subscription${n === 1 ? '' : 's'} renewing soon`,
    intro: "Here's what to review:",
    totalLabel: 'TOTAL',
    chargesIn: (d) => (d === 0 ? 'today' : d === 1 ? 'in 1 day' : `in ${d} days`),
    todayLabel: 'today',
    cta: 'Open SubRadar',
  },
  es: {
    heading: (n) => `${n} suscripcion${n === 1 ? '' : 'es'} se renueva${n === 1 ? '' : 'n'} pronto`,
    intro: 'Esto es lo que debes revisar:',
    totalLabel: 'TOTAL',
    chargesIn: (d) => (d === 0 ? 'hoy' : d === 1 ? 'en 1 día' : `en ${d} días`),
    todayLabel: 'hoy',
    cta: 'Abrir SubRadar',
  },
  de: {
    heading: (n) => `${n} Abonnement${n === 1 ? '' : 's'} wird bald fällig`,
    intro: 'Das solltest du dir ansehen:',
    totalLabel: 'GESAMT',
    chargesIn: (d) => (d === 0 ? 'heute' : d === 1 ? 'morgen' : `in ${d} Tagen`),
    todayLabel: 'heute',
    cta: 'SubRadar öffnen',
  },
  fr: {
    heading: (n) => `${n} abonnement${n === 1 ? '' : 's'} bientôt renouvelé${n === 1 ? '' : 's'}`,
    intro: 'À vérifier :',
    totalLabel: 'TOTAL',
    chargesIn: (d) => (d === 0 ? "aujourd'hui" : d === 1 ? 'demain' : `dans ${d} jours`),
    todayLabel: "aujourd'hui",
    cta: 'Ouvrir SubRadar',
  },
  pt: {
    heading: (n) => `${n} assinatura${n === 1 ? '' : 's'} vencendo em breve`,
    intro: 'Confira:',
    totalLabel: 'TOTAL',
    chargesIn: (d) => (d === 0 ? 'hoje' : d === 1 ? 'amanhã' : `em ${d} dias`),
    todayLabel: 'hoje',
    cta: 'Abrir SubRadar',
  },
  zh: {
    heading: (n) => `${n} 个订阅即将续费`,
    intro: '需要确认的内容：',
    totalLabel: '合计',
    chargesIn: (d) => (d === 0 ? '今天' : d === 1 ? '明天' : `${d}天后`),
    todayLabel: '今天',
    cta: '打开 SubRadar',
  },
  ja: {
    heading: (n) => `${n}件のサブスクが更新されます`,
    intro: '確認内容：',
    totalLabel: '合計',
    chargesIn: (d) => (d === 0 ? '本日' : d === 1 ? '明日' : `${d}日後`),
    todayLabel: '本日',
    cta: 'SubRadar を開く',
  },
  ko: {
    heading: (n) => `${n}개 구독이 곧 갱신됩니다`,
    intro: '확인할 내용:',
    totalLabel: '합계',
    chargesIn: (d) => (d === 0 ? '오늘' : d === 1 ? '내일' : `${d}일 후`),
    todayLabel: '오늘',
    cta: 'SubRadar 열기',
  },
  kk: {
    heading: (n) => `${n} жазылым жақын арада жаңарады`,
    intro: 'Назар аударыңыз:',
    totalLabel: 'БАРЛЫҒЫ',
    chargesIn: (d) => (d === 0 ? 'бүгін' : d === 1 ? 'ертең' : `${d} күннен кейін`),
    todayLabel: 'бүгін',
    cta: 'SubRadar ашу',
  },
};

export interface DigestItem {
  name: string;
  amount: number;
  currency: string;
  daysLeft: number;
  dateStr: string;
}

/**
 * Single email containing every subscription whose reminder fires today
 * for one user. Replaces the old per-sub email loop that turned into
 * inbox spam once a user crossed ~5 active subs.
 */
export function buildDailyDigestEmail(opts: {
  locale: string;
  name: string;
  items: DigestItem[];
  totalAmount: number;
  currency: string;
}): string {
  const lang = (opts.locale ?? 'en').split('-')[0].toLowerCase();
  const s = DIGEST_STRINGS[lang] ?? DIGEST_STRINGS.en;
  const fmt = (a: number, c: string) =>
    new Intl.NumberFormat(opts.locale || 'en', {
      style: 'currency',
      currency: c || 'USD',
      maximumFractionDigits: 2,
    }).format(isFinite(a) ? a : 0);

  const rows = opts.items
    .map(
      (it) => `
        <tr>
          <td style="padding:12px 16px;border-bottom:1px solid rgba(139,92,246,0.15);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
            <div style="color:#ffffff;font-size:14px;font-weight:600;">${it.name}</div>
            <div style="color:#8B5CF6;font-size:12px;margin-top:2px;">${s.chargesIn(it.daysLeft)} · ${it.dateStr}</div>
          </td>
          <td align="right" style="padding:12px 16px;border-bottom:1px solid rgba(139,92,246,0.15);color:#ffffff;font-size:15px;font-weight:700;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;white-space:nowrap;">
            ${fmt(it.amount, it.currency)}
          </td>
        </tr>`,
    )
    .join('');

  const content = `
  <tr>
    <td style="background:linear-gradient(135deg,#1a1a2e 0%,#16213e 100%);border-radius:16px;border:1px solid rgba(139,92,246,0.3);padding:32px;">
      <h1 style="margin:0 0 8px;font-size:22px;color:#ffffff;font-weight:800;letter-spacing:-0.3px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
        ⏰ ${s.heading(opts.items.length)}
      </h1>
      <p style="margin:0 0 24px;font-size:14px;color:#a0a0b8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
        ${s.intro}
      </p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;border-collapse:collapse;background:rgba(139,92,246,0.08);border-radius:12px;border:1px solid rgba(139,92,246,0.2);overflow:hidden;">
        ${rows}
        <tr>
          <td style="padding:14px 16px;color:#a0a0b8;font-size:12px;font-weight:700;letter-spacing:1px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">${s.totalLabel}</td>
          <td align="right" style="padding:14px 16px;color:#8B5CF6;font-size:18px;font-weight:800;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">${fmt(opts.totalAmount, opts.currency)}</td>
        </tr>
      </table>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td align="center">
            <a href="${MOBILE_URL}" style="display:inline-block;background:linear-gradient(135deg,#8B5CF6,#6D28D9);color:#ffffff;text-decoration:none;font-size:15px;font-weight:700;padding:14px 36px;border-radius:12px;letter-spacing:0.3px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
              ${s.cta}
            </a>
          </td>
        </tr>
      </table>
    </td>
  </tr>`;

  const preheader =
    lang === 'ru'
      ? `${opts.items.length} подписок · ${fmt(opts.totalAmount, opts.currency)}`
      : `${opts.items.length} subs · ${fmt(opts.totalAmount, opts.currency)}`;
  return wrap(content, { preheader });
}
