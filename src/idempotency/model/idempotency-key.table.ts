import {
  bigint,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

export const IDEMPOTENCY_STATUS = {
  IN_PROGRESS: 'IN_PROGRESS',
  COMPLETED: 'COMPLETED',
} as const;

export const idempotencyKeys = pgTable(
  'idempotency_keys',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    idempotencyKey: uuid('idempotency_key').notNull().unique(),
    status: varchar('status', { length: 20 }).notNull().default(IDEMPOTENCY_STATUS.IN_PROGRESS),
    responseStatus: integer('response_status'),
    responseBody: text('response_body'),
    responseContentType: varchar('response_content_type', { length: 100 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  table => [index('idx_idempotency_key_expires').on(table.expiresAt)],
);

export type IdempotencyKeyRow = typeof idempotencyKeys.$inferSelect;
export type NewIdempotencyKeyRow = typeof idempotencyKeys.$inferInsert;
