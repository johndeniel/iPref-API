import Joi from 'joi';

export const envValidationSchema = Joi.object({
  DATABASE_URL: Joi.string()
    .uri({ scheme: ['postgres', 'postgresql'] })
    .required(),
  IDEMPOTENCY_TTL_SECONDS: Joi.number().integer().min(60).default(86400),
  // Managed Neon Auth (Better Auth) — JWT issuer for Bearer verification.
  NEON_AUTH_BASE_URL: Joi.string()
    .uri({ scheme: ['https'] })
    .required(),
  // Optional overrides; derived from BASE_URL when absent.
  NEON_AUTH_JWKS_URL: Joi.string()
    .uri({ scheme: ['https'] })
    .optional(),
  NEON_AUTH_ISSUER: Joi.string()
    .uri({ scheme: ['https'] })
    .optional(),
}).unknown(true);
