import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import Decimal from 'decimal.js';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../common/redis.module';
import { FxRateSnapshot } from './entities/fx-rate-snapshot.entity';

const REDIS_KEY = 'fx:latest';
const REDIS_REFRESH_LOCK = 'fx:refresh:lock';
const REDIS_TTL_SECONDS = 6 * 60 * 60;
const REFRESH_LOCK_TTL_SECONDS = 30;
const STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000;

// Primary: open.er-api.com — free, no key, 166 currencies, daily updates
// Fallback: frankfurter.dev — free, ECB data, fewer currencies (~33, no KZT/RUB)
const FX_PROVIDERS = [
  { url: 'https://open.er-api.com/v6/latest/USD', name: 'open.er-api.com' },
  { url: 'https://api.frankfurter.dev/v1/latest?base=USD', name: 'frankfurter.dev' },
] as const;

export interface FxRates {
  base: 'USD';
  rates: Record<string, number>;
  fetchedAt: Date;
  source: string;
}

@Injectable()
export class FxService {
  private readonly logger = new Logger(FxService.name);

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @InjectRepository(FxRateSnapshot)
    private readonly repo: Repository<FxRateSnapshot>,
  ) {}

  async getRates(): Promise<FxRates> {
    const cached = await this.redis.get(REDIS_KEY).catch(() => null);
    if (cached) {
      try {
        const parsed = JSON.parse(cached);
        return { ...parsed, fetchedAt: new Date(parsed.fetchedAt) };
      } catch {
        // corrupted cache entry; ignore and fall through
      }
    }

    const snapshot = await this.repo.findOne({
      where: {},
      order: { fetchedAt: 'DESC' },
    });

    if (snapshot) {
      const rates: FxRates = {
        base: 'USD',
        rates: snapshot.rates,
        fetchedAt: snapshot.fetchedAt,
        source: snapshot.source,
      };
      await this.redis
        .set(REDIS_KEY, JSON.stringify(rates), 'EX', REDIS_TTL_SECONDS)
        .catch((err) => this.logger.debug(`Redis SET ${REDIS_KEY} failed: ${err?.message}`));

      const ageMs = Date.now() - snapshot.fetchedAt.getTime();
      if (ageMs > STALE_THRESHOLD_MS) {
        this.refreshFromApi().catch((e) =>
          this.logger.warn(`Background FX refresh failed: ${e.message}`),
        );
      }
      return rates;
    }

    return this.refreshFromApi();
  }

  async refreshFromApi(): Promise<FxRates> {
    // Redis-based single-flight lock to prevent concurrent API calls across
    // multiple backend instances (cold start, cron, lazy refresh).
    const acquired = await this.redis
      .set(REDIS_REFRESH_LOCK, '1', 'EX', REFRESH_LOCK_TTL_SECONDS, 'NX')
      .catch(() => null);

    if (!acquired) {
      await new Promise((r) => setTimeout(r, 1500));
      const cached = await this.redis.get(REDIS_KEY).catch(() => null);
      if (cached) {
        try {
          const parsed = JSON.parse(cached);
          return { ...parsed, fetchedAt: new Date(parsed.fetchedAt) };
        } catch {
          // fall through
        }
      }
    }

    try {
      return await this.fetchFromProviders();
    } finally {
      if (acquired) {
        await this.redis
          .del(REDIS_REFRESH_LOCK)
          .catch((err) =>
            this.logger.debug(`Redis DEL ${REDIS_REFRESH_LOCK} failed: ${err?.message}`),
          );
      }
    }
  }

  private async fetchFromProviders(): Promise<FxRates> {
    const errors: string[] = [];
    for (const provider of FX_PROVIDERS) {
      try {
        const resp = await fetch(provider.url, { signal: AbortSignal.timeout(10_000) });
        if (!resp.ok) {
          errors.push(`${provider.name}: HTTP ${resp.status}`);
          continue;
        }
        const data: any = await resp.json();
        const rates: Record<string, number> | undefined = data?.rates;
        if (!rates || typeof rates.USD === 'undefined') {
          errors.push(`${provider.name}: response missing rates (got keys: ${Object.keys(data || {}).join(',')})`);
          continue;
        }

        const now = new Date();
        const entity = this.repo.create({
          base: 'USD',
          rates,
          source: provider.name,
          fetchedAt: now,
        });
        await this.repo.save(entity);

        const result: FxRates = {
          base: 'USD',
          rates,
          fetchedAt: now,
          source: provider.name,
        };
        await this.redis
          .set(REDIS_KEY, JSON.stringify(result), 'EX', REDIS_TTL_SECONDS)
          .catch((err) => this.logger.debug(`Redis SET ${REDIS_KEY} (fetched) failed: ${err?.message}`));
        this.logger.log(
          `FX rates fetched from ${provider.name}: ${Object.keys(rates).length} currencies`,
        );
        return result;
      } catch (e: any) {
        errors.push(`${provider.name}: ${e.message}`);
      }
    }
    throw new Error(`All FX providers failed: ${errors.join('; ')}`);
  }

  convert(
    amount: Decimal,
    from: string,
    to: string,
    rates: Record<string, number>,
  ): Decimal {
    if (from === to) return amount;
    const fromRate = from === 'USD' ? 1 : rates[from];
    const toRate = to === 'USD' ? 1 : rates[to];
    if (!fromRate || fromRate <= 0 || !isFinite(fromRate)) {
      throw new Error(`Invalid FX rate for ${from}`);
    }
    if (!toRate || toRate <= 0 || !isFinite(toRate)) {
      throw new Error(`Invalid FX rate for ${to}`);
    }
    // Wrap the numeric rates in Decimal before dividing/multiplying. Passing
    // raw Number to Decimal.div triggers internal Number→string conversion
    // per operand, which can preserve IEEE-754 artifacts (e.g. rate 0.1 +
    // 0.2 shows up as 0.30000000000000004). Explicit Decimal construction
    // avoids accumulating float error across large aggregates.
    return amount.div(new Decimal(fromRate)).mul(new Decimal(toRate));
  }
}
