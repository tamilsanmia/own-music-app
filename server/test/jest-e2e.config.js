/** End-to-end tests: test/*.e2e-spec.ts, run against the dev Postgres/Redis from docker-compose.dev.yml. */
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testRegex: '.*\\.e2e-spec\\.ts$',
  transform: { '^.+\\.ts$': 'ts-jest' },
  testEnvironment: 'node',
  setupFiles: ['<rootDir>/setup-env.ts'],
  testTimeout: 30000,
};
