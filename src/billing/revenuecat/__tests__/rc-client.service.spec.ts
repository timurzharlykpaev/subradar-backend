import axios from 'axios';
import { ConfigService } from '@nestjs/config';
import { RevenueCatClient } from '../rc-client.service';

jest.mock('axios');
jest.mock('axios-retry', () => ({
  __esModule: true,
  default: jest.fn(),
}));

const mockedAxios = axios as jest.Mocked<typeof axios>;

const makeCfg = (key: string | undefined = 'fake-key'): ConfigService =>
  ({ get: () => key }) as unknown as ConfigService;

describe('RevenueCatClient', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getSubscriber', () => {
    it('returns a normalized RCSubscriberSnapshot', async () => {
      const get = jest.fn(async () => ({
        data: {
          subscriber: {
            entitlements: {
              pro: {
                expires_date: '2026-05-01T00:00:00Z',
                product_identifier: 'io.subradar.mobile.pro.monthly',
              },
            },
            original_purchase_date: '2026-04-01T00:00:00Z',
          },
        },
      }));
      mockedAxios.create.mockReturnValue({ get } as any);

      const client = new RevenueCatClient(makeCfg());
      const sub = await client.getSubscriber('user-1');

      expect(get).toHaveBeenCalledWith('/subscribers/user-1');
      expect(sub.entitlements.pro).toBeDefined();
      expect(sub.entitlements.pro.expiresAt).toBeInstanceOf(Date);
      expect(sub.entitlements.pro.expiresAt?.toISOString()).toBe(
        '2026-05-01T00:00:00.000Z',
      );
      expect(sub.entitlements.pro.productId).toBe(
        'io.subradar.mobile.pro.monthly',
      );
      expect(sub.latestExpirationMs).toBe(
        new Date('2026-05-01T00:00:00Z').getTime(),
      );
      expect(sub.cancelAtPeriodEnd).toBe(false);
      expect(sub.billingIssueDetectedAt).toBeNull();
    });

    it('URL-encodes the appUserId', async () => {
      const get = jest.fn(async () => ({ data: { subscriber: {} } }));
      mockedAxios.create.mockReturnValue({ get } as any);

      const client = new RevenueCatClient(makeCfg());
      await client.getSubscriber('user+1@test.com');

      expect(get).toHaveBeenCalledWith(
        '/subscribers/user%2B1%40test.com',
      );
    });

    it('handles multiple entitlements and picks the latest expiration', async () => {
      const get = jest.fn(async () => ({
        data: {
          subscriber: {
            entitlements: {
              pro: {
                expires_date: '2026-05-01T00:00:00Z',
                product_identifier: 'io.subradar.mobile.pro.monthly',
              },
              team: {
                expires_date: '2026-07-15T00:00:00Z',
                product_identifier: 'io.subradar.mobile.team.yearly',
              },
            },
          },
        },
      }));
      mockedAxios.create.mockReturnValue({ get } as any);

      const client = new RevenueCatClient(makeCfg());
      const sub = await client.getSubscriber('user-1');

      expect(Object.keys(sub.entitlements)).toEqual(['pro', 'team']);
      expect(sub.entitlements.team.productId).toBe(
        'io.subradar.mobile.team.yearly',
      );
      expect(sub.latestExpirationMs).toBe(
        new Date('2026-07-15T00:00:00Z').getTime(),
      );
    });

    it('sets cancelAtPeriodEnd=true when any subscription has unsubscribe_detected_at', async () => {
      const get = jest.fn(async () => ({
        data: {
          subscriber: {
            entitlements: {
              pro: {
                expires_date: '2026-05-01T00:00:00Z',
                product_identifier: 'io.subradar.mobile.pro.monthly',
              },
            },
            subscriptions: {
              'io.subradar.mobile.pro.monthly': {
                unsubscribe_detected_at: '2026-04-10T00:00:00Z',
              },
            },
          },
        },
      }));
      mockedAxios.create.mockReturnValue({ get } as any);

      const client = new RevenueCatClient(makeCfg());
      const sub = await client.getSubscriber('user-1');

      expect(sub.cancelAtPeriodEnd).toBe(true);
    });

    it('parses billing_issues_detected_at as Date', async () => {
      const get = jest.fn(async () => ({
        data: {
          subscriber: {
            entitlements: {},
            billing_issues_detected_at: '2026-04-18T12:00:00Z',
          },
        },
      }));
      mockedAxios.create.mockReturnValue({ get } as any);

      const client = new RevenueCatClient(makeCfg());
      const sub = await client.getSubscriber('user-1');

      expect(sub.billingIssueDetectedAt).toBeInstanceOf(Date);
      expect(sub.billingIssueDetectedAt?.toISOString()).toBe(
        '2026-04-18T12:00:00.000Z',
      );
    });

    it('returns null fields when subscriber has no entitlements/issues', async () => {
      const get = jest.fn(async () => ({
        data: { subscriber: {} },
      }));
      mockedAxios.create.mockReturnValue({ get } as any);

      const client = new RevenueCatClient(makeCfg());
      const sub = await client.getSubscriber('user-1');

      expect(sub.entitlements).toEqual({});
      expect(sub.latestExpirationMs).toBeNull();
      expect(sub.cancelAtPeriodEnd).toBe(false);
      expect(sub.billingIssueDetectedAt).toBeNull();
    });
  });

  describe('circuit breaker', () => {
    it('opens after 10 failures within a minute and short-circuits further calls', async () => {
      const get = jest.fn(async () => {
        throw new Error('network error');
      });
      mockedAxios.create.mockReturnValue({ get } as any);

      const client = new RevenueCatClient(makeCfg());

      // 10 real failures to accumulate timestamps
      for (let i = 0; i < 10; i++) {
        await expect(client.getSubscriber('u')).rejects.toThrow(
          'network error',
        );
      }

      // 11th attempt should be short-circuited before hitting axios
      const callsBefore = get.mock.calls.length;
      await expect(client.getSubscriber('u')).rejects.toThrow(
        /circuit breaker open/,
      );
      expect(get.mock.calls.length).toBe(callsBefore);
    });
  });

  describe('constructor', () => {
    it('configures axios with bearer auth and RC base URL', () => {
      const get = jest.fn();
      mockedAxios.create.mockReturnValue({ get } as any);

      new RevenueCatClient(makeCfg('secret-key'));

      expect(mockedAxios.create).toHaveBeenCalledWith(
        expect.objectContaining({
          baseURL: 'https://api.revenuecat.com/v1',
          headers: { Authorization: 'Bearer secret-key' },
          timeout: 10_000,
        }),
      );
    });

    it('still constructs when REVENUECAT_API_KEY is missing (logs a warning)', () => {
      const get = jest.fn();
      mockedAxios.create.mockReturnValue({ get } as any);

      const cfgNoKey = { get: () => undefined } as unknown as ConfigService;
      expect(() => new RevenueCatClient(cfgNoKey)).not.toThrow();
      expect(mockedAxios.create).toHaveBeenCalledWith(
        expect.objectContaining({
          headers: { Authorization: 'Bearer ' },
        }),
      );
    });
  });
});
