import { Inject, Injectable, Logger } from '@nestjs/common';
import { DRIZZLE } from '../../database/database.constants.js';
import type { DrizzleDb } from '../../database/drizzle.types.js';
import { IDEMPOTENCY_STATUS, type IdempotencyKeyRow } from '../model/idempotency-key.table.js';
import { IdempotencyKeyRepository } from '../repository/idempotency-key.repository.js';

export type FindOrCreateResult =
  | { outcome: 'completed'; record: IdempotencyKeyRow }
  | { outcome: 'in-progress' }
  | { outcome: 'created'; record: IdempotencyKeyRow };

const isExpired = (expiresAt: Date): boolean => Date.now() > expiresAt.getTime();

// 23505 = lost an INSERT race; 40P01 = deadlocked with the winner (already
// aborted ours). Drizzle nests the pg error under `.cause`, so walk the chain.
const RACE_CODES = new Set(['23505', '40P01']);

const isRaceWithRival = (error: unknown): boolean => {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && typeof current === 'object' && current !== null; depth++) {
    const record = current as { code?: unknown; cause?: unknown };
    if (typeof record.code === 'string' && RACE_CODES.has(record.code)) return true;
    current = record.cause;
  }
  return false;
};

@Injectable()
export class IdempotencyKeyService {
  private readonly logger = new Logger(IdempotencyKeyService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDb,
    private readonly repository: IdempotencyKeyRepository,
  ) {}

  async findOrCreate(key: string, ttlSeconds: number): Promise<FindOrCreateResult> {
    try {
      return await this.db.transaction(async tx => {
        const existing = await this.repository.findByKeyForUpdate(key, tx);
        if (existing) {
          if (!isExpired(existing.expiresAt)) {
            if (existing.status === IDEMPOTENCY_STATUS.COMPLETED) {
              return { outcome: 'completed', record: existing } as const;
            }
            return { outcome: 'in-progress' } as const;
          }
          await this.repository.deleteById(existing.id, tx);
        }
        const record = await this.repository.insert(
          { idempotencyKey: key, expiresAt: new Date(Date.now() + ttlSeconds * 1000) },
          tx,
        );
        return { outcome: 'created', record } as const;
      });
    } catch (error) {
      if (!isRaceWithRival(error)) throw error;
      // A rival owns this key; pick up its row. Never throw from here — degrade to 409.
      try {
        return await this.db.transaction(async tx => {
          const existing = await this.repository.findByKeyForUpdate(key, tx);
          if (
            existing &&
            !isExpired(existing.expiresAt) &&
            existing.status === IDEMPOTENCY_STATUS.COMPLETED
          ) {
            return { outcome: 'completed', record: existing } as const;
          }
          return { outcome: 'in-progress' } as const;
        });
      } catch (pickupError) {
        this.logger.warn(
          `Idempotency pickup failed for key=${key}, degrading to in-progress: ${(pickupError as Error).message}`,
        );
        return { outcome: 'in-progress' } as const;
      }
    }
  }

  async markCompleted(
    record: IdempotencyKeyRow,
    status: number,
    body: string,
    contentType: string | undefined,
  ): Promise<void> {
    await this.repository.markCompleted(record.id, status, body, contentType, this.db);
  }

  async release(record: IdempotencyKeyRow): Promise<void> {
    try {
      await this.repository.deleteById(record.id, this.db);
    } catch (error) {
      this.logger.warn(
        `Failed to release idempotency key id=${record.id}: ${(error as Error).message}`,
      );
    }
  }
}
