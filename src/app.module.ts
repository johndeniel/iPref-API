import { MiddlewareConsumer, Module, NestModule, RequestMethod } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { WinstonModule } from 'nest-winston';
import { AuthModule } from './auth/auth.module.js';
import { loggerConfig } from './common/logging/logger.config.js';
import { LoggingMiddleware } from './common/logging/logging.middleware.js';
import { LoggingModule } from './common/logging/logging.module.js';
import { envValidationSchema } from './config/env.validation.js';
import { DatabaseModule } from './database/database.module.js';
import { HealthController } from './health/health.controller.js';
import { IdempotencyMiddleware } from './idempotency/filter/idempotency.middleware.js';
import { IdempotencyModule } from './idempotency/idempotency.module.js';
import { PersonalInformationModule } from './personal-information/personal-information.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validationSchema: envValidationSchema }),
    WinstonModule.forRoot(loggerConfig),
    LoggingModule,
    DatabaseModule,
    AuthModule,
    IdempotencyModule,
    PersonalInformationModule,
  ],
  controllers: [HealthController],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // Order mirrors Profile-API: logging first, then idempotency.
    consumer.apply(LoggingMiddleware).forRoutes('*');
    consumer
      .apply(IdempotencyMiddleware)
      .forRoutes({ path: 'v1/personal-information', method: RequestMethod.POST });
  }
}
