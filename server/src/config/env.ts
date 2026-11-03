import { z } from 'zod';

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
