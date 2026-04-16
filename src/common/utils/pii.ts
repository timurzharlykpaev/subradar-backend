/**
 * PII masking helpers — use whenever logging user-identifying fields.
 * Goal: keep enough context to debug without writing raw emails/tokens to logs.
 */

/**
 * Mask an email for logs: `alice@example.com` → `al***@example.com`.
 * Local-part shorter than 3 chars → `***@example.com`.
 * Invalid input → `***` (never throw).
 */
export function maskEmail(email: string | null | undefined): string {
  if (!email || typeof email !== 'string') return '***';
  const at = email.indexOf('@');
  if (at <= 0) return '***';
  const local = email.slice(0, at);
  const domain = email.slice(at);
  if (local.length <= 2) return `***${domain}`;
  return `${local.slice(0, 2)}***${domain}`;
}

/**
 * Mask an opaque ID (refresh token, magic link token, etc.) — keep first 4 chars.
 */
export function maskToken(token: string | null | undefined): string {
  if (!token || typeof token !== 'string') return '***';
  if (token.length <= 6) return '***';
  return `${token.slice(0, 4)}***`;
}
