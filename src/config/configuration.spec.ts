import configuration from './configuration';

describe('configuration', () => {
  it('returns default config values', () => {
    const config = configuration();
    expect(config.port).toBe(3000);
    expect(['development', 'test']).toContain(config.nodeEnv);
    expect(config.jwt.secret).toBe('jwt-secret-change-me');
    expect(config.database.host).toBe('localhost');
    expect(config.database.port).toBe(5432);
  });

  it('parses PORT from environment', () => {
    process.env.PORT = '4000';
    const config = configuration();
    expect(config.port).toBe(4000);
    delete process.env.PORT;
  });

  it('parses NODE_ENV from environment', () => {
    process.env.NODE_ENV = 'production';
    const config = configuration();
    expect(config.nodeEnv).toBe('production');
    delete process.env.NODE_ENV;
  });

  it('includes all required sections', () => {
    const config = configuration();
    expect(config).toHaveProperty('database');
    expect(config).toHaveProperty('redis');
    expect(config).toHaveProperty('jwt');
    expect(config).toHaveProperty('google');
    expect(config).toHaveProperty('openai');
    expect(config).toHaveProperty('lemonSqueezy');
    expect(config).toHaveProperty('firebase');
    expect(config).toHaveProperty('resend');
  });

  it('handles FIREBASE_PRIVATE_KEY with escaped newlines', () => {
    process.env.FIREBASE_PRIVATE_KEY = 'key\\npart2';
    const config = configuration();
    expect(config.firebase.privateKey).toBe('key\npart2');
    delete process.env.FIREBASE_PRIVATE_KEY;
  });
});
