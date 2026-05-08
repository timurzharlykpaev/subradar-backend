import configuration, {
  DEV_JWT_ACCESS_SENTINEL,
  DEV_JWT_REFRESH_SENTINEL,
} from './configuration';

describe('configuration', () => {
  it('returns default config values in non-prod', () => {
    const prevPort = process.env.PORT;
    const prevNodeEnv = process.env.NODE_ENV;
    const prevJwt = process.env.JWT_SECRET;
    const prevJwtAccess = process.env.JWT_ACCESS_SECRET;
    const prevJwtRefresh = process.env.JWT_REFRESH_SECRET;
    const prevDbHost = process.env.DB_HOST;
    const prevDbPort = process.env.DB_PORT;
    delete process.env.PORT;
    // NODE_ENV='development' so the dev sentinel branch fires; deleting it
    // entirely would now (correctly) fail-closed.
    process.env.NODE_ENV = 'development';
    delete process.env.JWT_SECRET;
    delete process.env.JWT_ACCESS_SECRET;
    delete process.env.JWT_REFRESH_SECRET;
    delete process.env.DB_HOST;
    delete process.env.DB_PORT;
    try {
      const config = configuration();
      expect(config.port).toBe(3000);
      expect(['development', 'test']).toContain(config.nodeEnv);
      // Dev-only sentinels — exact constants exported from configuration.ts.
      expect(config.jwt.secret).toBe(DEV_JWT_ACCESS_SENTINEL);
      expect(config.jwt.refreshSecret).toBe(DEV_JWT_REFRESH_SENTINEL);
      expect(DEV_JWT_ACCESS_SENTINEL).not.toBe(DEV_JWT_REFRESH_SENTINEL);
      expect(config.database.host).toBe('localhost');
      expect(config.database.port).toBe(5432);
    } finally {
      if (prevPort !== undefined) process.env.PORT = prevPort;
      if (prevNodeEnv !== undefined) process.env.NODE_ENV = prevNodeEnv;
      if (prevJwt !== undefined) process.env.JWT_SECRET = prevJwt;
      if (prevJwtAccess !== undefined)
        process.env.JWT_ACCESS_SECRET = prevJwtAccess;
      if (prevJwtRefresh !== undefined)
        process.env.JWT_REFRESH_SECRET = prevJwtRefresh;
      if (prevDbHost !== undefined) process.env.DB_HOST = prevDbHost;
      if (prevDbPort !== undefined) process.env.DB_PORT = prevDbPort;
    }
  });

  it('parses PORT from environment', () => {
    process.env.PORT = '4000';
    const config = configuration();
    expect(config.port).toBe(4000);
    delete process.env.PORT;
  });

  it.each(['production', 'staging', 'preview', 'PRODUCTION', ''])(
    'throws when JWT secrets are missing and NODE_ENV=%p',
    (nodeEnv) => {
      const prevNodeEnv = process.env.NODE_ENV;
      const prevJwtAccess = process.env.JWT_ACCESS_SECRET;
      const prevJwtRefresh = process.env.JWT_REFRESH_SECRET;
      delete process.env.JWT_ACCESS_SECRET;
      delete process.env.JWT_REFRESH_SECRET;
      process.env.NODE_ENV = nodeEnv;
      try {
        expect(() => configuration()).toThrow(/Missing required secret/);
      } finally {
        if (prevNodeEnv !== undefined) process.env.NODE_ENV = prevNodeEnv;
        else delete process.env.NODE_ENV;
        if (prevJwtAccess !== undefined)
          process.env.JWT_ACCESS_SECRET = prevJwtAccess;
        if (prevJwtRefresh !== undefined)
          process.env.JWT_REFRESH_SECRET = prevJwtRefresh;
      }
    },
  );

  it('rejects whitespace-only secret values', () => {
    const prevNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    process.env.JWT_ACCESS_SECRET = '   \t  \n ';
    process.env.JWT_REFRESH_SECRET = '   ';
    try {
      expect(() => configuration()).toThrow(/Missing required secret/);
    } finally {
      if (prevNodeEnv !== undefined) process.env.NODE_ENV = prevNodeEnv;
      else delete process.env.NODE_ENV;
      delete process.env.JWT_ACCESS_SECRET;
      delete process.env.JWT_REFRESH_SECRET;
    }
  });

  it('uses production secrets when set', () => {
    const prevNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    process.env.JWT_ACCESS_SECRET = 'a'.repeat(64);
    process.env.JWT_REFRESH_SECRET = 'b'.repeat(64);
    try {
      const config = configuration();
      expect(config.jwt.secret).toBe('a'.repeat(64));
      expect(config.jwt.refreshSecret).toBe('b'.repeat(64));
    } finally {
      if (prevNodeEnv !== undefined) process.env.NODE_ENV = prevNodeEnv;
      else delete process.env.NODE_ENV;
      delete process.env.JWT_ACCESS_SECRET;
      delete process.env.JWT_REFRESH_SECRET;
    }
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
