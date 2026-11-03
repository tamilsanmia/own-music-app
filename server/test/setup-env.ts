// Defaults for e2e tests. They point at docker-compose.dev.yml services on the host network.
// Values already present in the environment win.
const defaults: Record<string, string> = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://music:music@127.0.0.1:5433/music_test?schema=public',
  CORS_ORIGIN: 'http://localhost:5173',
  JWT_SECRET: 'test-jwt-secret-test-jwt-secret-0123456789',
  ADMIN_EMAIL: 'admin@test.local',
  ADMIN_PASSWORD: 'admin-password-123',
};

for (const [key, value] of Object.entries(defaults)) {
  if (!process.env[key]) process.env[key] = value;
}
