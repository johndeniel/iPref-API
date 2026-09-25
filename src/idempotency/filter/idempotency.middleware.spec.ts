import type { ConfigService } from '@nestjs/config';
import type { NextFunction, Request, Response } from 'express';
import type { IdempotencyKeyRow } from '../model/idempotency-key.table.js';
import type { IdempotencyKeyService } from '../service/idempotency-key.service.js';
import { IdempotencyMiddleware } from './idempotency.middleware.js';

type MockFn = ReturnType<typeof vi.fn>;

interface MockResponse {
  status: MockFn;
  set: MockFn;
  send: MockFn;
  json: MockFn;
  setHeader: MockFn;
  getHeader: MockFn;
  once: MockFn;
  removeListener: MockFn;
  write: MockFn;
  end: MockFn;
  statusCode: number;
}

const completed = (): IdempotencyKeyRow => ({
  id: 7,
  idempotencyKey: '11111111-1111-4111-8111-111111111111',
  status: 'COMPLETED',
  responseStatus: 201,
  responseBody: '{"id":"abc"}',
  responseContentType: 'application/json; charset=utf-8',
  createdAt: new Date(),
  expiresAt: new Date(Date.now() + 3_600_000),
});

describe('IdempotencyMiddleware', () => {
  const service = {
    findOrCreate: vi.fn(),
    markCompleted: vi.fn(),
    release: vi.fn(),
  };
  const config = {
    getOrThrow: vi.fn(() => 86400),
  };
  const middleware = new IdempotencyMiddleware(
    service as unknown as IdempotencyKeyService,
    config as unknown as ConfigService,
  );

  const req = (overrides = {}): Request =>
    ({
      method: 'POST',
      path: '/v1/personal-information',
      headers: { 'idempotency-key': '11111111-1111-4111-8111-111111111111' },
      ...overrides,
    }) as unknown as Request;

  const res = (): MockResponse => {
    const mocked: MockResponse = {
      status: vi.fn().mockReturnThis(),
      set: vi.fn().mockReturnThis(),
      send: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
      setHeader: vi.fn(),
      getHeader: vi.fn(),
      once: vi.fn(),
      removeListener: vi.fn(),
      write: vi.fn(),
      end: vi.fn(),
      statusCode: 201,
    };
    return mocked;
  };

  const use = (request: Request, response: MockResponse, next: MockFn): Promise<void> =>
    middleware.use(request, response as unknown as Response, next as unknown as NextFunction);

  beforeEach(() => vi.clearAllMocks());

  it('passes non-POST requests straight through', async () => {
    const next = vi.fn();
    await use(req({ method: 'GET' }), res(), next);
    expect(next).toHaveBeenCalledOnce();
    expect(service.findOrCreate).not.toHaveBeenCalled();
  });

  it('passes non-allowlisted paths straight through', async () => {
    const next = vi.fn();
    await use(req({ path: '/health' }), res(), next);
    expect(next).toHaveBeenCalledOnce();
    expect(service.findOrCreate).not.toHaveBeenCalled();
  });

  it('rejects a missing key with 400', async () => {
    const next = vi.fn();
    const response = res();
    await use(req({ headers: {} }), response, next);
    expect(response.status).toHaveBeenCalledWith(400);
    expect(response.json).toHaveBeenCalledWith({
      status: 400,
      error: 'Bad Request',
      message: 'Missing required header: Idempotency-Key',
    });
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects a non-UUID key with 400', async () => {
    const next = vi.fn();
    const response = res();
    await use(req({ headers: { 'idempotency-key': 'not-a-uuid' } }), response, next);
    expect(response.status).toHaveBeenCalledWith(400);
    expect(response.json).toHaveBeenCalledWith({
      status: 400,
      error: 'Bad Request',
      message: 'Idempotency-Key must be a valid UUID',
    });
    expect(next).not.toHaveBeenCalled();
  });

  it('answers 409 while the key is in progress', async () => {
    service.findOrCreate.mockResolvedValue({ outcome: 'in-progress' });
    const response = res();
    await use(req(), response, vi.fn());
    expect(response.status).toHaveBeenCalledWith(409);
    expect(response.json).toHaveBeenCalledWith({
      status: 409,
      error: 'Conflict',
      message: 'Request with this Idempotency-Key is already processing',
    });
  });

  it('replays completed responses byte-for-byte without calling next', async () => {
    service.findOrCreate.mockResolvedValue({ outcome: 'completed', record: completed() });
    const next = vi.fn();
    const response = res();
    await use(req(), response, next);
    expect(response.status).toHaveBeenCalledWith(201);
    expect(response.set).toHaveBeenCalledWith('content-type', 'application/json; charset=utf-8');
    expect(response.set).toHaveBeenCalledWith(
      'Idempotency-Key',
      '11111111-1111-4111-8111-111111111111',
    );
    expect(response.send).toHaveBeenCalledWith('{"id":"abc"}');
    expect(next).not.toHaveBeenCalled();
  });

  it('echoes the key and continues on first use', async () => {
    service.findOrCreate.mockResolvedValue({ outcome: 'created', record: completed() });
    const next = vi.fn();
    const response = res();
    await use(req(), response, next);
    expect(response.setHeader).toHaveBeenCalledWith(
      'Idempotency-Key',
      '11111111-1111-4111-8111-111111111111',
    );
    expect(response.once).toHaveBeenCalledWith('finish', expect.any(Function));
    expect(next).toHaveBeenCalledOnce();
  });
});
