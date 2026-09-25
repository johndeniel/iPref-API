import type { NextFunction, Response } from 'express';
import * as winston from 'winston';
import type { Logger as WinstonLogger } from 'winston';
import type { LoggedRequest } from './logging.middleware.js';
import { LoggingMiddleware } from './logging.middleware.js';
import { LoggingService } from './logger.factory.js';

const createRequest = (url: string): LoggedRequest =>
  ({
    method: 'GET',
    url,
    originalUrl: url,
    ip: '127.0.0.1',
    headers: {},
    socket: { remoteAddress: '127.0.0.1' },
  }) as unknown as LoggedRequest;

describe('LoggingMiddleware', () => {
  let service: LoggingService;
  let middleware: LoggingMiddleware;
  let info: ReturnType<typeof vi.fn>;
  let finishHandler: () => void;

  const createResponse = (statusCode: number): Response => {
    finishHandler = () => {};
    return {
      statusCode,
      on: (event: string, handler: () => void) => {
        if (event === 'finish') finishHandler = handler;
        return undefined;
      },
    } as unknown as Response;
  };

  beforeEach(() => {
    const base = winston.createLogger({ level: 'info', silent: true });
    service = new LoggingService(base);
    info = vi.fn();
    vi.spyOn(service, 'getLogger').mockReturnValue({ info } as unknown as WinstonLogger);
    middleware = new LoggingMiddleware(service);
  });

  it('logs GET /health with HEALTH context and calls next', () => {
    const req = createRequest('/health');
    const res = createResponse(200);
    const next: NextFunction = vi.fn();

    middleware.use(req, res, next);
    finishHandler();

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.requestId).toEqual(expect.any(String));
    expect(req.boundedContext).toBe('HEALTH');
    expect(info).toHaveBeenCalledTimes(1);
    const [message, meta] = info.mock.calls[0] as [
      string,
      { boundedContext?: string; statusCode?: number },
    ];
    expect(message).toContain('GET /health 200 - OK');
    expect(meta.boundedContext).toBe('HEALTH');
    expect(meta.statusCode).toBe(200);
  });

  it('leaves boundedContext undefined for unknown routes', () => {
    const req = createRequest('/unknown');
    const res = createResponse(404);
    const next: NextFunction = vi.fn();

    middleware.use(req, res, next);
    finishHandler();

    expect(req.boundedContext).toBeUndefined();
    const [, meta] = info.mock.calls[0] as [string, { boundedContext?: string }];
    expect(meta.boundedContext).toBeUndefined();
  });
});
