import { Inject, Injectable } from '@nestjs/common';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { Logger as WinstonLogger } from 'winston';

export interface LogContext {
  requestId?: string;
  clientIp?: string;
  boundedContext?: string;
  httpMethod?: string;
  requestUri?: string;
}

@Injectable()
export class LoggingService {
  private static readonly storage = new AsyncLocalStorage<LogContext>();
  private readonly cache = new Map<string, WinstonLogger>();

  constructor(@Inject(WINSTON_MODULE_PROVIDER) private readonly base: WinstonLogger) {}

  getLogger(context: string): WinstonLogger {
    const cached = this.cache.get(context);
    if (cached) return cached;
    const child = this.base.child({ context });
    this.cache.set(context, child);
    return child;
  }

  static getStore(): LogContext | undefined {
    return LoggingService.storage.getStore();
  }

  static setContext(key: keyof LogContext, value: string): void {
    const store = LoggingService.storage.getStore();
    if (store) store[key] = value;
  }

  static removeContext(key: keyof LogContext): void {
    const store = LoggingService.storage.getStore();
    if (store) delete store[key];
  }

  static clearContext(): void {
    const store = LoggingService.storage.getStore();
    if (store) {
      (Object.keys(store) as (keyof LogContext)[]).forEach(key => delete store[key]);
    }
  }

  static runWithContext<R>(context: LogContext, action: () => R): R {
    return LoggingService.storage.run(context, action);
  }
}
