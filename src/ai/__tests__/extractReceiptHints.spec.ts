import { extractReceiptHints } from '../ai.service';

/**
 * Locks down the regex-based receipt-hint pass that feeds candidate
 * amounts and a sender-derived brand to the AI. Without these hints
 * AppScreens-style processor-issued receipts (Link / Stripe / Paddle
 * wrapping a small SaaS merchant) consistently slipped through with
 * `amountFromEmail=false` because the AI couldn't reliably mine the
 * value out of a 4 KB HTML body on its own.
 */
describe('extractReceiptHints', () => {
  const baseMsg = {
    from: 'Link <receipts@appscreens.com>',
    subject: 'Your AppScreens receipt',
    snippet: 'AppScreens $29.00',
  };
  const appScreensBody =
    'AppScreens $29.00 Manage subscription You will see a charge from LINK.COM*APPSCREENS.C on your statement.';

  it('extracts the dominant USD amount from a Link/AppScreens receipt', () => {
    const hints = extractReceiptHints(baseMsg, appScreensBody);
    expect(hints.candidateAmounts).toContainEqual(
      expect.objectContaining({ currency: 'USD', value: 29 }),
    );
  });

  it('derives a brand from the sender domain when the display name is the PSP ("Link")', () => {
    const hints = extractReceiptHints(baseMsg, appScreensBody);
    expect(hints.senderBrand).toBe('Appscreens');
  });

  it('flags recurring vs one-time correctly on a Link receipt with "Manage subscription"', () => {
    const hints = extractReceiptHints(baseMsg, appScreensBody);
    expect(hints.recurringCueCount).toBeGreaterThan(0);
    expect(hints.oneTimeCueCount).toBe(0);
  });

  it('refuses to brand-name a PSP-issued email (sender domain is stripe.com)', () => {
    const hints = extractReceiptHints(
      {
        from: 'Stripe <support@stripe.com>',
        subject: 'Your Acme receipt',
        snippet: 'Acme $49',
      },
      'Acme Pro $49.00 monthly. Manage subscription.',
    );
    // Sender is a payment processor — the brand must come from the
    // body (the AI does that pass), not from the sender domain. Hints
    // returning null prevents a "Stripe" false-brand from poisoning
    // the AI choice.
    expect(hints.senderBrand).toBeNull();
  });

  it('parses European decimal commas (e.g. 19,99 €)', () => {
    const hints = extractReceiptHints(
      {
        from: 'no-reply@example.de',
        subject: 'Rechnung',
        snippet: '19,99 € pro Monat',
      },
      'Vielen Dank für Ihren Kauf. Betrag: 19,99 € pro Monat. Abonnement verwalten.',
    );
    expect(hints.candidateAmounts).toContainEqual(
      expect.objectContaining({ currency: 'EUR', value: 19.99 }),
    );
  });

  it('parses an order-confirmation as one-time, not recurring', () => {
    const hints = extractReceiptHints(
      {
        from: 'orders@store.example',
        subject: 'Thanks for your order',
        snippet: 'Order #1234 — $42.00',
      },
      'Thanks for your order. Total: $42.00. Your order has shipped. Tracking number: ABC123.',
    );
    expect(hints.recurringCueCount).toBe(0);
    expect(hints.oneTimeCueCount).toBeGreaterThan(0);
  });

  it('caps the candidate-amounts list at 3 unique values', () => {
    const body =
      '$5.00 first $10.00 second $15.00 third $20.00 fourth $25.00 fifth';
    const hints = extractReceiptHints(
      { from: 'a@b.com', subject: 's', snippet: '' },
      body,
    );
    expect(hints.candidateAmounts).toHaveLength(3);
    expect(hints.candidateAmounts[0].value).toBe(5);
    expect(hints.candidateAmounts[2].value).toBe(15);
  });

  it('skips the "noreply" / "billing" subdomain prefix when deriving brand', () => {
    const hints = extractReceiptHints(
      {
        from: 'billing@mail.notion.so',
        subject: 'Receipt',
        snippet: 'Notion',
      },
      '',
    );
    expect(hints.senderBrand).toBe('Notion');
  });
});
