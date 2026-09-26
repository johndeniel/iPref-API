import { asc, desc, ilike, sql, type SQL } from 'drizzle-orm';
import type { AnyPgColumn, PgTable } from 'drizzle-orm/pg-core';
import { z } from 'zod';
import type { DrizzleDb } from '../database/drizzle.types.js';

export interface Paginated<T> {
  content: T[];
  totalElements: number;
  totalPages: number;
  page: number;
  size: number;
}

export interface SortablePageQuery<F extends string> {
  page: number;
  size: number;
  sortBy: F;
  sortDirection: 'asc' | 'desc';
}

/** Escape LIKE wildcards so user input matches literally inside ILIKE. */
export const escapeLike = (value: string): string =>
  value.replace(/[\\%_]/g, match => `\\${match}`);

/** Case-insensitive substring filter on a single column. */
export const containsFilter = (column: AnyPgColumn, value: string): SQL =>
  ilike(column, `%${escapeLike(value)}%`);

/** The paginated envelope every list endpoint returns; feeds Swagger response schemas. */
export const pageEnvelope = <T extends z.ZodType>(item: T) =>
  z.object({
    content: z.array(item),
    totalElements: z.number(),
    totalPages: z.number(),
    page: z.number(),
    size: z.number(),
  });

/**
 * Shared list engine: one place for sort, limit/offset paging, and the
 * total count. Filters arrive as a prebuilt WHERE so each resource keeps
 * its own filter semantics (exact, per-field contains, global search).
 */
export const listPaginated = async <TTable extends PgTable, F extends string>(
  db: DrizzleDb,
  options: {
    table: TTable;
    where: SQL | undefined;
    query: SortablePageQuery<F>;
    sortColumns: Record<F, AnyPgColumn>;
  },
): Promise<Paginated<TTable['$inferSelect']>> => {
  const { table, where, query, sortColumns } = options;
  const column = sortColumns[query.sortBy];
  const orderBy = query.sortDirection === 'asc' ? asc(column) : desc(column);
  // Widening to the concrete base type keeps drizzle's generic `.from()`
  // conditional happy; the caller's table type still drives the result type.
  const fromTable: PgTable = table;

  const [rows, countRows] = await Promise.all([
    db
      .select()
      .from(fromTable)
      .where(where)
      .orderBy(orderBy)
      .limit(query.size)
      .offset(query.page * query.size),
    db
      .select({ total: sql`count(*)`.mapWith(Number) })
      .from(fromTable)
      .where(where),
  ]);

  const total = countRows[0]?.total ?? 0;
  return {
    content: rows as unknown as TTable['$inferSelect'][],
    totalElements: total,
    totalPages: Math.ceil(total / query.size),
    page: query.page,
    size: query.size,
  };
};
