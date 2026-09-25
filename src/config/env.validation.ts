import Joi from 'joi';

export const envValidationSchema = Joi.object({
  DATABASE_URL: Joi.string()
    .uri({ scheme: ['postgres', 'postgresql'] })
    .required(),
  IDEMPOTENCY_TTL_SECONDS: Joi.number().integer().min(60).default(86400),
}).unknown(true);
