import { validateEnv } from './env';

describe('validateEnv', () => {
  const base = {
    DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
    JWT_SECRET: 'x'.repeat(32),
    STREAM_SECRET: 'y'.repeat(32),
  };

  it('applies defaults', () => {
    const env = validateEnv(base);
    expect(env).toMatchObject({
      NODE_ENV: 'development',
      PORT: 3000,
      CORS_ORIGIN: 'https://music.snowsig.in',
      MEDIA_ROOT: '/srv/music',
      JWT_ACCESS_TTL_SECONDS: 900,
      REFRESH_TTL_DAYS: 30,
    });
    expect(env.ADMIN_EMAIL).toBeUndefined();
  });

  it('coerces PORT from a string', () => {
    expect(validateEnv({ ...base, PORT: '8080' }).PORT).toBe(8080);
  });

  it('rejects a missing DATABASE_URL', () => {
    expect(() => validateEnv({ ...base, DATABASE_URL: undefined })).toThrow(/DATABASE_URL/);
  });

  it('rejects a non-postgres DATABASE_URL', () => {
    expect(() => validateEnv({ ...base, DATABASE_URL: 'mysql://x' })).toThrow(/postgres/);
  });

  it('does not leak values in the error message', () => {
    const secret = 'mysql://user:supersecret@host/db';
    expect(() => validateEnv({ ...base, DATABASE_URL: secret })).toThrow(
      expect.objectContaining({ message: expect.not.stringContaining('supersecret') }),
    );
  });

  it('rejects an invalid PORT', () => {
    expect(() => validateEnv({ ...base, PORT: '70000' })).toThrow(/PORT/);
  });

  it('requires a long JWT_SECRET', () => {
    expect(() => validateEnv({ ...base, JWT_SECRET: 'short' })).toThrow(/JWT_SECRET/);
  });

  it('normalizes ADMIN_EMAIL and treats empty values as unset', () => {
    expect(validateEnv({ ...base, ADMIN_EMAIL: ' Admin@Music.Snowsig.IN ' }).ADMIN_EMAIL).toBe(
      'admin@music.snowsig.in',
    );
    expect(validateEnv({ ...base, ADMIN_EMAIL: '', ADMIN_PASSWORD: '' }).ADMIN_PASSWORD).toBeUndefined();
  });
});
