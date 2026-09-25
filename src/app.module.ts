import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { WinstonModule } from 'nest-winston';
import { loggerConfig } from './common/logging/logger.config.js';
import { LoggingMiddleware } from './common/logging/logging.middleware.js';
import { LoggingModule } from './common/logging/logging.module.js';
import { HealthController } from './health/health.controller.js';

@Module({
  imports: [WinstonModule.forRoot(loggerConfig), LoggingModule],
  controllers: [HealthController],
  providers: [],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(LoggingMiddleware).forRoutes('*');
  }
}
