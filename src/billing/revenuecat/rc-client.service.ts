import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';
import axiosRetry from 'axios-retry';
import { RCSubscriberSnapshot } from '../state-machine/types';

/**
 * RevenueCat REST API client.
 *
 * - axios instance with 10s timeout + Bearer auth (REVENUECAT_API_KEY from ConfigService)
 * - retries 3x on 5xx with exponential backoff (500ms, 1000ms, 2000ms)
 * - circuit breaker: throws if >=10 failures happened in the last 60s
 *
 * Used by ReconciliationService (Task 5.2) to pull the authoritative
 * subscription state from RC and compare it with our DB.
 */
@Injectable()
export class RevenueCatClient {
  private readonly logger = new Logger(RevenueCatClient.name);
  private readonly http: AxiosInstance;
  private failureTimestamps: number[] = [];

  constructor(cfg: ConfigService) {
    const apiKey = cfg.get<string>('REVENUECAT_API_KEY');
    if (!apiKey) {
      this.logger.warn(
        'REVENUECAT_API_KEY not set — RC client will fail on all calls',
      );
    }
    this.http = axios.create({
      baseURL: 'https://api.revenuecat.com/v1',
      headers: { Authorization: `Bearer ${apiKey ?? ''}` },
      timeout: 10_000,
    });
    axiosRetry(this.http, {
      retries: 3,
      retryDelay: (retryCount) => 500 * Math.pow(2, retryCount),
      retryCondition: (error) =>
        !!error.response && error.response.status >= 500,
    });
  }

  /**
   * Simple in-memory circuit breaker: if the last minute accumulated
   * 10+ failures, new requests are short-circuited so we don't hammer
   * RC during an outage.
   */
  private checkCircuit(): void {
    const now = Date.now();
    this.failureTimestamps = this.failureTimestamps.filter(
      (t) => now - t < 60_000,
    );
    if (this.failureTimestamps.length >= 10) {
      throw new Error(
        'RC circuit breaker open: too many failures in the last minute',
      );
    }
  }

  /**
   * Fetch a subscriber by appUserId and return a normalized snapshot.
   * Endpoint: GET /v1/subscribers/{app_user_id}
   */
  async getSubscriber(appUserId: string): Promise<RCSubscriberSnapshot> {
    this.checkCircuit();
    try {
      const { data } = await this.http.get(
        `/subscribers/${encodeURIComponent(appUserId)}`,
      );
      return this.normalize(data?.subscriber);
    } catch (err) {
      this.failureTimestamps.push(Date.now());
      throw err;
    }
  }

  /**
   * Convert raw RC API response shape into our internal RCSubscriberSnapshot.
   *
   * RC returns `expires_date` as ISO string and `product_identifier` per
   * entitlement; we store them as Date/string on `{ expiresAt, productId }`.
   * `cancelAtPeriodEnd` is inferred from any active subscription having
   * `unsubscribe_detected_at` set.
   */
  private normalize(raw: any): RCSubscriberSnapshot {
    const entitlements: RCSubscriberSnapshot['entitlements'] = {};
    let latestExp = 0;

    for (const [key, val] of Object.entries(raw?.entitlements ?? {})) {
      const v = val as any;
      const exp = v?.expires_date ? new Date(v.expires_date) : null;
      entitlements[key] = {
        expiresAt: exp,
        productId: v?.product_identifier ?? '',
      };
      if (exp) latestExp = Math.max(latestExp, exp.getTime());
    }

    const subs = raw?.subscriptions ?? {};
    const activeSub = Object.values(subs).find(
      (s: any) => s?.unsubscribe_detected_at,
    );

    return {
      entitlements,
      latestExpirationMs: latestExp || null,
      cancelAtPeriodEnd: !!activeSub,
      billingIssueDetectedAt: raw?.billing_issues_detected_at
        ? new Date(raw.billing_issues_detected_at)
        : null,
    };
  }
}
