import type { DrizzleDb, DrizzleTx } from '../../database/drizzle.types.js';
import type { IdempotencyKeyRow } from '../model/idempotency-key.table.js';
import type { IdempotencyKeyRepository } from '../repository/idempotency-key.repository.js';
import { IdempotencyKeyService } from './idempotency-key.service.js';

const fresh = (overrides: Partial<IdempotencyKeyRow> = {}): IdempotencyKeyRow => ({
  id: 7,
  idempotencyKey: '11111111-1111-4111-8111-111111111111',
  status: 'IN_PROGRESS',
  responseStatus: null,
  responseBody: null,
  responseContentType: null,
  createdAt: new Date(),
  expiresAt: new Date(Date.now() + 3_600_000),
  ...overrides,
});

describe('IdempotencyKeyService', () => {
  const tx = {};
  const db = {
    transaction: vi.fn(async <T>(cb: (tx: DrizzleTx) => Promise<T>): Promise<T> =>
      cb(tx as DrizzleTx),
    ),
  };
  const repository = {
    findByKeyForUpdate: vi.fn(),
    insert: vi.fn(),
    markCompleted: vi.fn(),
    deleteById: vi.fn(),
  };
  const service = new IdempotencyKeyService(
    db as unknown as DrizzleDb,
    repository as unknown as IdempotencyKeyRepository,
  );

  beforeEach(() => vi.clearAllMocks());

  it('creates a fresh key with a TTL expiry', async () => {
    repository.findByKeyForUpdate.mockResolvedValue(undefined);
    repository.insert.mockImplementation((row: { expiresAt: Date }) => fresh(row));
    const result = await service.findOrCreate('11111111-1111-4111-8111-111111111111', 86400);
    expect(result.outcome).toBe('created');
    if (result.outcome !== 'created') throw new Error('unreachable');
    expect(result.record.expiresAt.getTime()).toBeGreaterThan(Date.now() + 86_000_000);
    expect(repository.deleteById).not.toHaveBeenCalled();
  });

  it('returns completed keys for replay', async () => {
    repository.findByKeyForUpdate.mockResolvedValue(
      fresh({ status: 'COMPLETED', responseStatus: 201, responseBody: '{}' }),
    );
    const result = await service.findOrCreate('11111111-1111-4111-8111-111111111111', 86400);
    expect(result.outcome).toBe('completed');
    expect(repository.insert).not.toHaveBeenCalled();
  });

  it('reports in-progress keys so the caller can answer 409', async () => {
    repository.findByKeyForUpdate.mockResolvedValue(fresh());
    const result = await service.findOrCreate('11111111-1111-4111-8111-111111111111', 86400);
    expect(result).toEqual({ outcome: 'in-progress' });
    expect(repository.insert).not.toHaveBeenCalled();
  });

  it('recycles expired keys', async () => {
    repository.findByKeyForUpdate.mockResolvedValue(
      fresh({ status: 'COMPLETED', expiresAt: new Date(Date.now() - 1000) }),
    );
    repository.insert.mockImplementation((row: { expiresAt: Date }) => fresh(row));
    const result = await service.findOrCreate('11111111-1111-4111-8111-111111111111', 86400);
    expect(repository.deleteById).toHaveBeenCalledWith(7, tx);
    expect(result.outcome).toBe('created');
  });

  it('picks up the winner after a unique-violation race', async () => {
    repository.findByKeyForUpdate
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(fresh({ status: 'COMPLETED', responseStatus: 201 }));
    repository.insert.mockRejectedValueOnce({ code: '23505' });
    const result = await service.findOrCreate('11111111-1111-4111-8111-111111111111', 86400);
    expect(result.outcome).toBe('completed');
  });

  it('picks up the winner when drizzle wraps the violation in cause', async () => {
    repository.findByKeyForUpdate
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(fresh({ status: 'COMPLETED', responseStatus: 201 }));
    const wrapped = new Error('Failed query: insert into "idempotency_keys"') as Error & {
      cause: unknown;
    };
    wrapped.cause = { code: '23505' };
    repository.insert.mockRejectedValueOnce(wrapped);
    const result = await service.findOrCreate('11111111-1111-4111-8111-111111111111', 86400);
    expect(result.outcome).toBe('completed');
  });

  it('treats a deadlock as a race and picks up the winner', async () => {
    repository.findByKeyForUpdate
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(fresh({ status: 'COMPLETED', responseStatus: 201 }));
    repository.insert.mockRejectedValueOnce({ code: '40P01' });
    const result = await service.findOrCreate('11111111-1111-4111-8111-111111111111', 86400);
    expect(result.outcome).toBe('completed');
  });

  it('degrades to in-progress when the pickup read itself fails', async () => {
    repository.findByKeyForUpdate.mockResolvedValueOnce(undefined);
    repository.insert.mockRejectedValueOnce({ code: '23505' });
    const failingDb = {
      transaction: vi
        .fn()
        .mockImplementationOnce(async <T>(cb: (tx: DrizzleTx) => Promise<T>): Promise<T> =>
          cb(tx as DrizzleTx),
        )
        .mockRejectedValueOnce(new Error('connection reset')),
    };
    const failingService = new IdempotencyKeyService(
      failingDb as unknown as DrizzleDb,
      repository as unknown as IdempotencyKeyRepository,
    );
    const result = await failingService.findOrCreate('11111111-1111-4111-8111-111111111111', 86400);
    expect(result).toEqual({ outcome: 'in-progress' });
  });

  it('rethrows non-unique errors', async () => {
    repository.findByKeyForUpdate.mockResolvedValue(undefined);
    repository.insert.mockRejectedValueOnce(new Error('boom'));
    await expect(
      service.findOrCreate('11111111-1111-4111-8111-111111111111', 86400),
    ).rejects.toThrow('boom');
  });
});
