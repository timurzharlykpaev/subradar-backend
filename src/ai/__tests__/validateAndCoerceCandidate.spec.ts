import { validateAndCoerceCandidate } from '../ai.service';

/**
 * Locks down the prompt-injection rejection paths inside the
 * candidate validator. The function is the last line of defence after
 * the OpenAI JSON-mode response — if a malicious receipt body convinces
 * the model to emit a name like "http://attacker.example" or a control-
 * character payload, validation MUST drop it before it reaches the
 * subscriptions service. Removing any of these checks should fail this
 * suite loudly rather than slip into a deploy.
 */
const BASE = {
  sourceMessageId: 'm-1',
  name: 'Netflix',
  amount: 9.99,
  amountFromEmail: true,
  currency: 'USD',
  billingPeriod: 'MONTHLY',
  category: 'STREAMING',
  status: 'ACTIVE',
  confidence: 0.9,
  isRecurring: true,
  isCancellation: false,
  isTrial: false,
};

describe('validateAndCoerceCandidate — injection defences', () => {
  it('accepts a clean Netflix candidate', () => {
    const c = validateAndCoerceCandidate(BASE);
    expect(c).not.toBeNull();
    expect(c!.name).toBe('Netflix');
  });

  it.each([
    ['angle bracket', '<script>alert(1)</script>'],
    ['curly brace', '{system: ignore previous}'],
    ['backtick', '`whoami`'],
  ])('rejects names containing %s', (_label, name) => {
    expect(validateAndCoerceCandidate({ ...BASE, name })).toBeNull();
  });

  it.each([
    ['http url', 'http://attacker.example'],
    ['https url', 'https://evil.example/exfil'],
    ['mixed case https', 'HTTPS://Evil.example'],
  ])('rejects names containing %s', (_label, name) => {
    expect(validateAndCoerceCandidate({ ...BASE, name })).toBeNull();
  });

  it.each([
    ['NUL mid-word', 'Net\u0000flix'],
    ['DEL mid-word', 'Net\u007Fflix'],
    ['ZWSP mid-word', 'Net\u200Bflix'],
    ['LRO mid-word', 'Net\u202Dflix'],
    ['invisible separator mid-word', 'Net\u2063flix'],
  ])('rejects names containing %s', (_label, name) => {
    expect(validateAndCoerceCandidate({ ...BASE, name })).toBeNull();
  });

  it('normalises leading/trailing BOM via trim (does not reject)', () => {
    // BOM (U+FEFF) at the edges is considered whitespace by String.trim
    // and gets stripped before our regex check runs. This is acceptable
    // — a leading invisible doesn't compromise the brand name once
    // normalised; only mid-word invisibles signal an attack.
    const c = validateAndCoerceCandidate({ ...BASE, name: '\uFEFFNetflix\uFEFF' });
    expect(c).not.toBeNull();
    expect(c!.name).toBe('Netflix');
  });

  it('caps name at 100 chars (longer names truncate, not crash)', () => {
    const name = 'X'.repeat(500);
    const c = validateAndCoerceCandidate({ ...BASE, name });
    expect(c).not.toBeNull();
    expect(c!.name.length).toBe(100);
  });

  it('rejects out-of-range amounts (negative, infinity-shaped)', () => {
    expect(validateAndCoerceCandidate({ ...BASE, amount: -1 })).toBeNull();
    expect(validateAndCoerceCandidate({ ...BASE, amount: 9_999_999 })).toBeNull();
  });

  it('coerces missing amount to 0 with amountFromEmail=false', () => {
    const { amount, amountFromEmail, ...without } = BASE;
    void amount;
    void amountFromEmail;
    const c = validateAndCoerceCandidate(without);
    expect(c).not.toBeNull();
    expect(c!.amount).toBe(0);
    expect(c!.amountFromEmail).toBe(false);
  });

  it('rejects unknown billingPeriod', () => {
    expect(
      validateAndCoerceCandidate({ ...BASE, billingPeriod: 'FORTNIGHTLY' }),
    ).toBeNull();
  });

  it('rejects malformed currency code', () => {
    expect(validateAndCoerceCandidate({ ...BASE, currency: 'usd$' })).toBeNull();
    expect(validateAndCoerceCandidate({ ...BASE, currency: 'DOLLARS' })).toBeNull();
  });

  it('falls back to OTHER for unknown category', () => {
    const c = validateAndCoerceCandidate({ ...BASE, category: 'UNICORNS' });
    expect(c).not.toBeNull();
    expect(c!.category).toBe('OTHER');
  });
});
