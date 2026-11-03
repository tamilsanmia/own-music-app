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

  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
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
