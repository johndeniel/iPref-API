import { STATUS_CODES } from 'node:http';
import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { firstHeader } from '../http/headers.js';
import type { LogContext } from './logger.factory.js';
import { LoggingService } from './logger.factory.js';

export interface LoggedRequest extends Request {
  requestId?: string;
  clientIp?: string;
  boundedContext?: string;
}

const URI_CONTEXT_MAP: Record<string, string> = {
  '/health': 'HEALTH',
  '/api-docs': 'DOCS',
  '/v1/personal-information': 'PERSONAL',
};

const resolveBoundedContext = (uri: string): string | undefined => {
  for (const [prefix, context] of Object.entries(URI_CONTEXT_MAP)) {
    if (uri.startsWith(prefix)) return context;
  }
  return undefined;
};

const statusDescription = (statusCode: number): string => STATUS_CODES[statusCode] ?? 'Unknown';

const getClientIp = (req: Request): string => {
  const forwarded = firstHeader(req.headers['x-forwarded-for']);
  if (forwarded && forwarded.length > 0) return forwarded.split(',')[0]?.trim() ?? 'unknown';
  const realIp = firstHeader(req.headers['x-real-ip']);
  if (realIp && realIp.length > 0) return realIp;
  return req.ip ?? req.socket?.remoteAddress ?? 'unknown';
};

@Injectable()
export class LoggingMiddleware implements NestMiddleware {
  constructor(private readonly logging: LoggingService) {}

  use(req: LoggedRequest, res: Response, next: NextFunction): void {
    const requestUri = req.originalUrl ?? req.url;
    const context: LogContext = {
      requestId: uuidv4().slice(0, 8),
      clientIp: getClientIp(req),
      httpMethod: req.method,
      requestUri,
      boundedContext: resolveBoundedContext(requestUri),
    };
    req.requestId = context.requestId;
    req.clientIp = context.clientIp;
    req.boundedContext = context.boundedContext;

    const startTime = Date.now();
    const log = this.logging.getLogger(LoggingMiddleware.name);

    LoggingService.runWithContext(context, () => {
      res.on('finish', () => {
        try {
          const duration = Date.now() - startTime;
          const statusCode = res.statusCode;
          log.info(
            `${req.method} ${requestUri} ${statusCode} - ${statusDescription(statusCode)} [${duration}ms]`,
            {
              requestId: context.requestId,
              clientIp: context.clientIp,
              boundedContext: context.boundedContext,
              httpMethod: req.method,
              requestUri,
              statusCode,
              durationMs: duration,
            },
          );
        } finally {
          LoggingService.clearContext();
        }
      });
      next();
    });
  }
}
