import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

export const REDIS_CLIENT = 'REDIS_CLIENT';

@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      useFactory: (cfg: ConfigService) => {
        const url = cfg.get<string>('REDIS_URL') || 'redis://localhost:6379';
        const client = new Redis(url, { maxRetriesPerRequest: 3, lazyConnect: true });
        client.connect().catch((e) => {
          console.warn('Redis connect failed (non-blocking):', e?.message);
        });
        return client;
      },
      inject: [ConfigService],
    },
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule {}
