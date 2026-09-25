import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DRIZZLE } from '../../database/database.constants.js';
import type { DrizzleClient, DrizzleDb } from '../../database/drizzle.types.js';
import {
  IDEMPOTENCY_STATUS,
  idempotencyKeys,
  type IdempotencyKeyRow,
  type NewIdempotencyKeyRow,
} from '../model/idempotency-key.table.js';

@Injectable()
export class IdempotencyKeyRepository {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDb) {}

  async findByKeyForUpdate(
    key: string,
    client: DrizzleClient,
  ): Promise<IdempotencyKeyRow | undefined> {
    const rows = await client
      .select()
      .from(idempotencyKeys)
      .where(eq(idempotencyKeys.idempotencyKey, key))
      .for('update');
    return rows[0];
  }

  async insert(row: NewIdempotencyKeyRow, client: DrizzleClient): Promise<IdempotencyKeyRow> {
    const rows = await client.insert(idempotencyKeys).values(row).returning();
    const created = rows[0];
    if (!created) throw new Error('Idempotency key insert returned no row');
    return created;
  }

  async markCompleted(
    id: number,
    responseStatus: number,
    responseBody: string,
    responseContentType: string | undefined,
    client: DrizzleClient,
  ): Promise<void> {
    await client
      .update(idempotencyKeys)
      .set({
        status: IDEMPOTENCY_STATUS.COMPLETED,
        responseStatus,
        responseBody,
        responseContentType: responseContentType ?? null,
      })
      .where(eq(idempotencyKeys.id, id));
  }

  async deleteById(id: number, client: DrizzleClient): Promise<void> {
    await client.delete(idempotencyKeys).where(eq(idempotencyKeys.id, id));
  }
}
