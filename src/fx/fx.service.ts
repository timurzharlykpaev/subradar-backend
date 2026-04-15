import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import Decimal from 'decimal.js';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../common/redis.module';
import { FxRateSnapshot } from './entities/fx-rate-snapshot.entity';

const REDIS_KEY = 'fx:latest';
const REDIS_TTL_SECONDS = 6 * 60 * 60;
const STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000;
const SOURCE = 'exchangerate.host';

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
        .catch(() => {});

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
    const resp = await fetch('https://api.exchangerate.host/latest?base=USD');
    if (!resp.ok) {
      throw new Error(`FX API returned HTTP ${resp.status}`);
    }
    const data: any = await resp.json();
    if (!data?.rates || typeof data.rates.USD === 'undefined') {
      throw new Error('FX API response missing rates');
    }

    const now = new Date();
    const entity = this.repo.create({
      base: 'USD',
      rates: data.rates,
      source: SOURCE,
      fetchedAt: now,
    });
    await this.repo.save(entity);

    const result: FxRates = {
      base: 'USD',
      rates: data.rates,
      fetchedAt: now,
      source: SOURCE,
    };
    await this.redis
      .set(REDIS_KEY, JSON.stringify(result), 'EX', REDIS_TTL_SECONDS)
      .catch(() => {});
    return result;
  }

  convert(
    amount: Decimal,
    from: string,
    to: string,
    rates: Record<string, number>,
  ): Decimal {
    if (from === to) return amount;
    const fromRate = rates[from];
    const toRate = rates[to];
    if (!fromRate) throw new Error(`No FX rate for ${from}`);
    if (!toRate) throw new Error(`No FX rate for ${to}`);
    return amount.div(fromRate).mul(toRate);
  }
}
