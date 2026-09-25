import { HttpStatus, Injectable, Logger, type NestMiddleware } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NextFunction, Request, Response } from 'express';
import { validate as isUuid } from 'uuid';
import { firstHeader } from '../../common/http/headers.js';
import type { IdempotencyKeyRow } from '../model/idempotency-key.table.js';
import {
  IdempotencyKeyService,
  type FindOrCreateResult,
} from '../service/idempotency-key.service.js';

export const IDEMPOTENCY_HEADER = 'Idempotency-Key';

// POST paths protected by idempotency. Extend as new POST resources are added.
export const IDEMPOTENT_POST_PATHS = ['/v1/personal-information'];

@Injectable()
export class IdempotencyMiddleware implements NestMiddleware {
  private readonly logger = new Logger(IdempotencyMiddleware.name);

  constructor(
    private readonly service: IdempotencyKeyService,
    private readonly config: ConfigService,
  ) {}

  async use(req: Request, res: Response, next: NextFunction): Promise<void> {
    if (req.method !== 'POST' || !IDEMPOTENT_POST_PATHS.includes(req.path)) {
      next();
      return;
    }

    const key = firstHeader(req.headers[IDEMPOTENCY_HEADER.toLowerCase()]);
    const ttl = this.config.getOrThrow<number>('IDEMPOTENCY_TTL_SECONDS');

    if (!key || key.trim().length === 0) {
      this.sendError(
        res,
        HttpStatus.BAD_REQUEST,
        'Bad Request',
        `Missing required header: ${IDEMPOTENCY_HEADER}`,
      );
      return;
    }
    if (!isUuid(key)) {
      this.sendError(
        res,
        HttpStatus.BAD_REQUEST,
        'Bad Request',
        `${IDEMPOTENCY_HEADER} must be a valid UUID`,
      );
      return;
    }

    let result: FindOrCreateResult;
    try {
      result = await this.service.findOrCreate(key, ttl);
    } catch (error) {
      this.logger.error(`Idempotency lookup failed: ${(error as Error).message}`);
      this.sendError(
        res,
        HttpStatus.INTERNAL_SERVER_ERROR,
        'Internal Server Error',
        'An unexpected error occurred',
      );
      return;
    }

    if (result.outcome === 'in-progress') {
      this.sendError(
        res,
        HttpStatus.CONFLICT,
        'Conflict',
        `Request with this ${IDEMPOTENCY_HEADER} is already processing`,
      );
      return;
    }
    if (result.outcome === 'completed') {
      // Key-only replay: first completed response wins, regardless of retry body.
      this.logger.log(`Replaying cached response for key=${key}`);
      this.replay(res, result.record);
      return;
    }

    const record = result.record;
    const chunks = this.captureBody(res);

    // 'finish' stores/completes the key; bare 'close' means the client went away.
    const onFinish = (): void => {
      res.removeListener('close', onClose);
      void (async () => {
        try {
          const status = res.statusCode;
          if (status >= 200 && status < 300) {
            const contentType = res.getHeader('content-type');
            await this.service.markCompleted(
              record,
              status,
              chunks().toString('utf8'),
              typeof contentType === 'string' ? contentType : undefined,
            );
          } else {
            await this.service.release(record);
          }
        } catch (error) {
          this.logger.warn(`Idempotency finalize failed: ${(error as Error).message}`);
        }
      })();
    };
    const onClose = (): void => {
      res.removeListener('finish', onFinish);
      void this.service.release(record);
    };
    res.once('finish', onFinish);
    res.once('close', onClose);

    res.setHeader(IDEMPOTENCY_HEADER, key);
    next();
  }

  private captureBody(res: Response): () => Buffer {
    const chunks: Buffer[] = [];
    const pushChunk = (chunk: unknown, encoding: unknown): void => {
      if (typeof chunk === 'string') {
        chunks.push(
          Buffer.from(chunk, (typeof encoding === 'string' ? encoding : 'utf8') as BufferEncoding),
        );
      } else if (Buffer.isBuffer(chunk)) {
        chunks.push(chunk);
      } else if (chunk instanceof Uint8Array) {
        chunks.push(Buffer.from(chunk));
      }
    };
    const rawWrite = res.write.bind(res) as (...args: unknown[]) => boolean;
    const rawEnd = res.end.bind(res) as (...args: unknown[]) => unknown;
    res.write = ((...args: unknown[]): boolean => {
      pushChunk(args[0], args[1]);
      return rawWrite(...args);
    }) as typeof res.write;
    res.end = ((...args: unknown[]): unknown => {
      pushChunk(args[0], args[1]);
      return rawEnd(...args);
    }) as typeof res.end;
    return () => Buffer.concat(chunks);
  }

  private replay(res: Response, record: IdempotencyKeyRow): void {
    res.status(record.responseStatus ?? HttpStatus.OK);
    if (record.responseContentType) res.set('content-type', record.responseContentType);
    res.set(IDEMPOTENCY_HEADER, record.idempotencyKey);
    res.send(record.responseBody ?? '');
  }

  private sendError(res: Response, status: number, error: string, message: string): void {
    res.status(status).json({ status, error, message });
  }
}
