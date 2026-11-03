import { z } from 'zod';

/** Treat empty strings (e.g. an unset key in a Kubernetes Secret) as missing. */
const optional = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((v) => (v === '' ? undefined : v), schema.optional());

/**
 * Environment schema. Every setting the server reads is declared here and validated at startup,
 * so a misconfigured pod fails fast instead of misbehaving at runtime.
 */
export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: z
    .string()
    .min(1, 'DATABASE_URL is required')
    .refine((v) => /^postgres(ql)?:\/\//.test(v), 'DATABASE_URL must be a postgres:// URL'),
  CORS_ORIGIN: z.string().url().default('https://music.snowsig.in'),
  MEDIA_ROOT: z.string().min(1).default('/srv/music'),

  REDIS_URL: z
    .string()
    .default('redis://127.0.0.1:6379')
    .refine((v) => /^rediss?:\/\//.test(v), 'REDIS_URL must be a redis:// URL'),
  /** Redis key prefix for the job queue; tests use their own so they don't collide. */
  QUEUE_PREFIX: z.string().min(1).default('music'),

  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  /** HMAC key for stream URLs. Separate from JWT_SECRET so one leaking doesn't expose the other. */
  STREAM_SECRET: z.string().min(32, 'STREAM_SECRET must be at least 32 characters'),
  STREAM_TTL_SECONDS: z.coerce.number().int().positive().default(6 * 60 * 60),
  JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().positive().default(15 * 60),
  REFRESH_TTL_DAYS: z.coerce.number().int().positive().default(30),

  /** When both are set, this admin account is created on startup if it does not exist yet. */
  ADMIN_EMAIL: optional(z.string().trim().toLowerCase().email()),
  ADMIN_PASSWORD: optional(z.string().min(8, 'ADMIN_PASSWORD must be at least 8 characters')),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(raw: Record<string, unknown>): Env {
  const result = envSchema.safeParse(raw);
  if (!result.success) {
    // Only report key names and messages, never values (they may be secrets).
    const issues = result.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`);
    throw new Error(`Invalid environment configuration:\n  ${issues.join('\n  ')}`);
  }
  return result.data;
}
