import { Global, Module } from '@nestjs/common';
import { LoggingService } from './logger.factory.js';
import { LoggingMiddleware } from './logging.middleware.js';

@Global()
@Module({
  providers: [LoggingService, LoggingMiddleware],
  exports: [LoggingService, LoggingMiddleware],
})
export class LoggingModule {}
