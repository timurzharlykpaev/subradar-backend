import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { BadRequestException } from '@nestjs/common';
import { createHmac } from 'crypto';
import { ResendWebhookController } from './resend-webhook.controller';
import { SuppressionService } from './suppression.service';

describe('ResendWebhookController', () => {
  let suppress: jest.Mock;
  let configGet: jest.Mock;

  async function build(secret = ''): Promise<ResendWebhookController> {
    suppress = jest.fn().mockResolvedValue(undefined);
    configGet = jest.fn().mockReturnValue(secret);
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ResendWebhookController],
      providers: [
        { provide: ConfigService, useValue: { get: configGet } },
        { provide: SuppressionService, useValue: { suppress } },
      ],
    }).compile();
    return module.get(ResendWebhookController);
  }

  function makeReq(
    headers: Record<string, string> = {},
    rawBody?: string,
  ): any {
    return { headers, rawBody };
  }

  describe('without signing secret (dev mode)', () => {
    it('suppresses hard bounce', async () => {
      const c = await build('');
      const r = await c.handle(makeReq(), {
        type: 'email.bounced',
        data: { to: ['Foo@Bar.COM'], bounce: { type: 'hard' } },
      });
      expect(r).toEqual({ received: true });
      expect(suppress).toHaveBeenCalledWith('Foo@Bar.COM', 'hard_bounce', expect.any(String));
    });

    it('detects soft bounce by bounce.type prefix', async () => {
      const c = await build('');
      await c.handle(makeReq(), {
        type: 'email.bounced',
        data: { to: ['a@b.com'], bounce: { type: 'soft' } },
      });
      expect(suppress).toHaveBeenCalledWith('a@b.com', 'soft_bounce', expect.any(String));
    });

    it('defaults to hard bounce when bounce.type is missing', async () => {
      const c = await build('');
      await c.handle(makeReq(), {
        type: 'email.bounced',
        data: { to: ['a@b.com'] },
      });
      expect(suppress).toHaveBeenCalledWith('a@b.com', 'hard_bounce', expect.any(String));
    });

    it('suppresses complaints', async () => {
      const c = await build('');
      await c.handle(makeReq(), {
        type: 'email.complained',
        data: { to: ['a@b.com'] },
      });
      expect(suppress).toHaveBeenCalledWith('a@b.com', 'complaint', expect.any(String));
    });

    it('ignores other event types (delivered, opened)', async () => {
      const c = await build('');
      const r = await c.handle(makeReq(), {
        type: 'email.delivered',
        data: { to: ['a@b.com'] },
      });
      expect(r).toEqual({ received: true });
      expect(suppress).not.toHaveBeenCalled();
    });

    it('ignores payloads without recipient', async () => {
      const c = await build('');
      const r = await c.handle(makeReq(), {
        type: 'email.bounced',
        data: {},
      });
      expect(r).toEqual({ received: true });
      expect(suppress).not.toHaveBeenCalled();
    });

    it('falls back to data.email when data.to is missing', async () => {
      const c = await build('');
      await c.handle(makeReq(), {
        type: 'email.complained',
        data: { email: 'x@y.com' },
      });
      expect(suppress).toHaveBeenCalledWith('x@y.com', 'complaint', expect.any(String));
    });
  });

  describe('with signing secret (prod mode)', () => {
    const secret = 'whsec_' + Buffer.from('topsecret').toString('base64');

    function svixSig(id: string, timestamp: string, body: string): string {
      const key = Buffer.from('topsecret').toString('base64');
      const keyBuf = Buffer.from(key, 'base64');
      const expected = createHmac('sha256', keyBuf)
        .update(`${id}.${timestamp}.${body}`)
        .digest('base64');
      return `v1,${expected}`;
    }

    it('rejects missing svix headers', async () => {
      const c = await build(secret);
      await expect(
        c.handle(makeReq({}, '{}'), { type: 'email.bounced', data: {} }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects missing raw body', async () => {
      const c = await build(secret);
      await expect(
        c.handle(
          makeReq({ 'svix-id': '1', 'svix-timestamp': '2', 'svix-signature': 'x' }),
          { type: 'email.bounced', data: {} },
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects invalid signature', async () => {
      const c = await build(secret);
      const body = JSON.stringify({ type: 'email.bounced', data: {} });
      await expect(
        c.handle(
          makeReq(
            { 'svix-id': '1', 'svix-timestamp': '2', 'svix-signature': 'v1,deadbeef' },
            body,
          ),
          { type: 'email.bounced', data: {} },
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('accepts a valid signature and suppresses', async () => {
      const c = await build(secret);
      const payload = {
        type: 'email.bounced',
        data: { to: ['bad@addr.com'], bounce: { type: 'hard' } },
      };
      const body = JSON.stringify(payload);
      const sig = svixSig('msg_1', '1700000000', body);
      await c.handle(
        makeReq(
          {
            'svix-id': 'msg_1',
            'svix-timestamp': '1700000000',
            'svix-signature': sig,
          },
          body,
        ),
        payload,
      );
      expect(suppress).toHaveBeenCalledWith('bad@addr.com', 'hard_bounce', expect.any(String));
    });
  });
});
