import { Global, Module } from '@nestjs/common';
import { IdempotencyMiddleware } from './filter/idempotency.middleware.js';
import { IdempotencyKeyRepository } from './repository/idempotency-key.repository.js';
import { IdempotencyKeyService } from './service/idempotency-key.service.js';

@Global()
@Module({
  providers: [IdempotencyKeyRepository, IdempotencyKeyService, IdempotencyMiddleware],
  exports: [IdempotencyKeyRepository, IdempotencyKeyService, IdempotencyMiddleware],
})
export class IdempotencyModule {}
