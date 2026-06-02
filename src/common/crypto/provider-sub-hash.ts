import { createHash } from 'crypto';

/**
 * Deterministic, queryable lookup key for an OAuth provider's stable
 * subject identifier (`sub`). Stored in `users.providerSubHash`.
 *
 * Why a hash and not the raw `sub`? `users.providerId` already holds the
 * same `sub`, but it is encrypted with a NON-deterministic AES-256-GCM
 * transformer, so every encrypt yields different ciphertext and the column
 * can never be used in a WHERE clause. We need an equality-searchable value
 * to re-identify a returning user when the provider omits the email — which
 * Apple does on every login after the first consent (it then sends only the
 * `sub`). sha256 is one-way, so the column stays queryable without ever
 * disclosing the raw `sub` at rest.
 *
 * The provider is folded into the digest so the same opaque `sub` issued by
 * two different providers can never collide into one account.
 */
export function hashProviderSub(provider: string, sub: string): string {
  return createHash('sha256').update(`${provider}:${sub}`).digest('hex');
}
