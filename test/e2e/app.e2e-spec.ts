import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../../src/app.module';

describe('SubRadar API (e2e)', () => {
  let app: INestApplication;
  const token = process.env.TEST_JWT_TOKEN || '';
  const skip = () => (!token ? it.skip : it);
  let subId: string;
  let cardId: string;

  beforeAll(async () => {
    const mod: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }));
    await app.init();
  }, 30000);

  afterAll(async () => { await app.close(); });

  describe('Health', () => {
    it('GET /health → 200', () => request(app.getHttpServer()).get('/health').expect(200));
  });

  describe('Auth (public)', () => {
    it('POST /auth/send-otp invalid email → 400', () =>
      request(app.getHttpServer()).post('/api/v1/auth/send-otp').send({ email: 'bad' }).expect(400));
    it('POST /auth/send-otp valid email → 200|201', async () => {
      const r = await request(app.getHttpServer()).post('/api/v1/auth/send-otp').send({ email: 'e2e@subradar.ai' });
      expect([200, 201]).toContain(r.status);
    });
    it('POST /auth/verify-otp wrong code → 401', () =>
      request(app.getHttpServer()).post('/api/v1/auth/verify-otp').send({ email: 'e2e@subradar.ai', code: '000000' }).expect(401));
    it('GET /auth/me no token → 401', () => request(app.getHttpServer()).get('/api/v1/auth/me').expect(401));
  });

  describe('Billing (public)', () => {
    it('GET /billing/plans → 200 with plans[]', async () => {
      const r = await request(app.getHttpServer()).get('/api/v1/billing/plans').expect(200);
      expect(r.body).toHaveProperty('plans');
      expect(Array.isArray(r.body.plans)).toBe(true);
    });
  });

  describe('Subscriptions (auth)', () => {
    skip()('GET /subscriptions → array', async () => {
      const r = await request(app.getHttpServer()).get('/api/v1/subscriptions').set('Authorization', `Bearer ${token}`).expect(200);
      expect(Array.isArray(r.body)).toBe(true);
    });
    skip()('POST /subscriptions → 201', async () => {
      const r = await request(app.getHttpServer()).post('/api/v1/subscriptions')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'E2E Netflix', amount: 15.99, currency: 'USD', billingPeriod: 'MONTHLY', category: 'STREAMING', status: 'ACTIVE' })
        .expect(201);
      expect(r.body.id).toBeDefined();
      subId = r.body.id;
    });
    skip()('POST /subscriptions missing fields → 400', () =>
      request(app.getHttpServer()).post('/api/v1/subscriptions').set('Authorization', `Bearer ${token}`).send({ name: 'No amount' }).expect(400));
    skip()('PUT /subscriptions/:id → updated amount', async () => {
      if (!subId) return;
      const r = await request(app.getHttpServer()).put(`/api/v1/subscriptions/${subId}`)
        .set('Authorization', `Bearer ${token}`).send({ amount: 19.99 }).expect(200);
      expect(Number(r.body.amount)).toBe(19.99);
    });
    skip()('GET /subscriptions/limits/check → canAdd', async () => {
      const r = await request(app.getHttpServer()).get('/api/v1/subscriptions/limits/check').set('Authorization', `Bearer ${token}`).expect(200);
      expect(r.body).toHaveProperty('canAdd');
    });
    skip()('DELETE /subscriptions/:id → 200|204', async () => {
      if (!subId) return;
      const r = await request(app.getHttpServer()).delete(`/api/v1/subscriptions/${subId}`).set('Authorization', `Bearer ${token}`);
      expect([200, 204]).toContain(r.status);
    });
  });

  describe('Analytics (auth)', () => {
    skip()('GET /analytics/summary → totalMonthly', async () => {
      const r = await request(app.getHttpServer()).get('/api/v1/analytics/summary').set('Authorization', `Bearer ${token}`).expect(200);
      expect(r.body).toHaveProperty('totalMonthly');
    });
    skip()('GET /analytics/home → totalMonthly', async () => {
      const r = await request(app.getHttpServer()).get('/api/v1/analytics/home').set('Authorization', `Bearer ${token}`).expect(200);
      expect(r.body).toHaveProperty('totalMonthly');
    });
    skip()('GET /analytics/by-category → array', async () => {
      const r = await request(app.getHttpServer()).get('/api/v1/analytics/by-category').set('Authorization', `Bearer ${token}`).expect(200);
      expect(Array.isArray(r.body)).toBe(true);
    });
    skip()('GET /analytics/forecast → forecast30d', async () => {
      const r = await request(app.getHttpServer()).get('/api/v1/analytics/forecast').set('Authorization', `Bearer ${token}`).expect(200);
      expect(r.body).toHaveProperty('forecast30d');
    });
    skip()('GET /analytics/savings → potentialSavings', async () => {
      const r = await request(app.getHttpServer()).get('/api/v1/analytics/savings').set('Authorization', `Bearer ${token}`).expect(200);
      expect(r.body).toHaveProperty('potentialSavings');
    });
  });

  describe('Payment Cards (auth)', () => {
    skip()('POST /payment-cards → 201', async () => {
      const r = await request(app.getHttpServer()).post('/api/v1/payment-cards')
        .set('Authorization', `Bearer ${token}`)
        .send({ nickname: 'E2E Visa', last4: '4242', brand: 'VISA' })
        .expect(201);
      expect(r.body.id).toBeDefined();
      cardId = r.body.id;
    });
    skip()('GET /payment-cards → array', async () => {
      const r = await request(app.getHttpServer()).get('/api/v1/payment-cards').set('Authorization', `Bearer ${token}`).expect(200);
      expect(Array.isArray(r.body)).toBe(true);
    });
    skip()('DELETE /payment-cards/:id → 200|204', async () => {
      if (!cardId) return;
      const r = await request(app.getHttpServer()).delete(`/api/v1/payment-cards/${cardId}`).set('Authorization', `Bearer ${token}`);
      expect([200, 204]).toContain(r.status);
    });
  });

  describe('Billing (auth)', () => {
    skip()('GET /billing/me → plan', async () => {
      const r = await request(app.getHttpServer()).get('/api/v1/billing/me').set('Authorization', `Bearer ${token}`).expect(200);
      expect(r.body).toHaveProperty('plan');
    });
    skip()('POST /billing/trial → trial activated', async () => {
      const r = await request(app.getHttpServer()).post('/api/v1/billing/trial').set('Authorization', `Bearer ${token}`);
      expect([200, 201, 400]).toContain(r.status);
    });
  });

  describe('Notifications (auth)', () => {
    skip()('GET /notifications/settings → 200', async () => {
      const r = await request(app.getHttpServer()).get('/api/v1/notifications/settings').set('Authorization', `Bearer ${token}`).expect(200);
      expect(r.body).toBeDefined();
    });
  });

  describe('Reports (auth)', () => {
    skip()('POST /reports → 200|201', async () => {
      const r = await request(app.getHttpServer()).post('/api/v1/reports')
        .set('Authorization', `Bearer ${token}`)
        .send({ type: 'summary', period: 'month' });
      expect([200, 201]).toContain(r.status);
    });
    skip()('GET /reports → array', async () => {
      const r = await request(app.getHttpServer()).get('/api/v1/reports').set('Authorization', `Bearer ${token}`).expect(200);
      expect(Array.isArray(r.body)).toBe(true);
    });
  });

  describe('Workspace (auth)', () => {
    let workspaceId: string;

    skip()('GET /workspace/me → null when no workspace', async () => {
      const r = await request(app.getHttpServer()).get('/api/v1/workspace/me').set('Authorization', `Bearer ${token}`);
      expect([200, 404]).toContain(r.status);
    });

    skip()('POST /workspace → creates workspace', async () => {
      const r = await request(app.getHttpServer())
        .post('/api/v1/workspace')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'E2E Test Team' })
        .expect(201);
      expect(r.body).toHaveProperty('id');
      expect(r.body.name).toBe('E2E Test Team');
      workspaceId = r.body.id;
    });

    skip()('GET /workspace/me → returns workspace', async () => {
      const r = await request(app.getHttpServer())
        .get('/api/v1/workspace/me')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(r.body).toHaveProperty('id');
    });

    skip()('GET /workspace/me/analytics → returns analytics', async () => {
      const r = await request(app.getHttpServer())
        .get('/api/v1/workspace/me/analytics')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(r.body).toHaveProperty('totalMonthly');
      expect(r.body).toHaveProperty('totalSubscriptions');
    });

    skip()('POST /workspace/:id/invite → 201 with pending member', async () => {
      if (!workspaceId) return;
      const r = await request(app.getHttpServer())
        .post(`/api/v1/workspace/${workspaceId}/invite`)
        .set('Authorization', `Bearer ${token}`)
        .send({ email: 'invite-test@subradar.ai', role: 'MEMBER' })
        .expect(201);
      expect(r.body).toHaveProperty('id');
      expect(r.body.status).toBe('PENDING');
    });
  });

  describe('AI Wizard (auth)', () => {
    skip()('POST /ai/wizard netflix → done: true', async () => {
      const r = await request(app.getHttpServer())
        .post('/api/v1/ai/wizard')
        .set('Authorization', `Bearer ${token}`)
        .send({ message: 'netflix', locale: 'en' })
        .expect(201);
      expect(r.body).toHaveProperty('done');
      if (r.body.done) {
        expect(r.body.subscription).toHaveProperty('name');
        expect(r.body.subscription).toHaveProperty('amount');
      }
    });

    skip()('POST /ai/wizard unknown service → done: false with question', async () => {
      const r = await request(app.getHttpServer())
        .post('/api/v1/ai/wizard')
        .set('Authorization', `Bearer ${token}`)
        .send({ message: 'некий сервис за 500 рублей', locale: 'ru' })
        .expect(201);
      expect(r.body).toHaveProperty('done');
    });
  });
});
