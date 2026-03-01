import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac } from 'crypto';
import { UsersService } from '../users/users.service';

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);
  private readonly webhookSecret: string;
  private readonly apiKey: string;
  private readonly storeId: string;

  constructor(
    private readonly cfg: ConfigService,
    private readonly usersService: UsersService,
  ) {
    this.webhookSecret = cfg.get('LEMON_SQUEEZY_WEBHOOK_SECRET', '');
    this.apiKey = cfg.get('LEMON_SQUEEZY_API_KEY', '');
    this.storeId = cfg.get('LEMON_SQUEEZY_STORE_ID', '');
  }

  verifyWebhookSignature(payload: string, signature: string): boolean {
    const hmac = createHmac('sha256', this.webhookSecret);
    const digest = hmac.update(payload).digest('hex');
    return digest === signature;
  }

  async handleWebhook(event: string, data: any) {
    this.logger.log(`Lemon Squeezy webhook: ${event}`);

    switch (event) {
      case 'subscription_created':
      case 'subscription_updated': {
        const customerId = data?.attributes?.customer_id;
        const email = data?.attributes?.user_email;
        const status = data?.attributes?.status;
        if (email) {
          const user = await this.usersService.findByEmail(email);
          if (user) {
            await this.usersService.update(user.id, {
              plan: status === 'active' ? 'pro' : 'free',
              lemonSqueezyCustomerId: String(customerId),
            });
          }
        }
        break;
      }
      case 'subscription_cancelled': {
        const email = data?.attributes?.user_email;
        if (email) {
          const user = await this.usersService.findByEmail(email);
          if (user) {
            await this.usersService.update(user.id, { plan: 'free' });
          }
        }
        break;
      }
      case 'order_created': {
        this.logger.log('Order created:', data?.id);
        break;
      }
    }
  }

  async createCheckout(userId: string, variantId: string, email: string) {
    const response = await fetch('https://api.lemonsqueezy.com/v1/checkouts', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/vnd.api+json',
        Accept: 'application/vnd.api+json',
      },
      body: JSON.stringify({
        data: {
          type: 'checkouts',
          attributes: {
            checkout_data: {
              email,
              custom: { user_id: userId },
            },
          },
          relationships: {
            store: { data: { type: 'stores', id: this.storeId } },
            variant: { data: { type: 'variants', id: variantId } },
          },
        },
      }),
    });

    const result = (await response.json()) as any;
    return { checkoutUrl: result?.data?.attributes?.url };
  }
}
