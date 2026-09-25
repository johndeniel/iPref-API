import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq, ilike, or, sql, type SQL } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { PaginatedResponseDto } from '../../common/dto/paginated-response.dto.js';
import { DRIZZLE } from '../../database/database.constants.js';
import type { DrizzleDb } from '../../database/drizzle.types.js';
import { personalInformation } from '../model/personal-information.table.js';
import type {
  CreatePersonalInformationInput,
  ListPersonalInformationQuery,
  PersonalInformation,
  PersonalInformationSortField,
  UpdatePersonalInformationInput,
} from '../schema/personal-information.schema.js';

const sortColumns: Record<PersonalInformationSortField, AnyPgColumn> = {
  fullName: personalInformation.fullName,
  phoneNumber: personalInformation.phoneNumber,
  createdAt: personalInformation.createdAt,
  updatedAt: personalInformation.updatedAt,
};

const escapeLike = (value: string): string => value.replace(/[\\%_]/g, match => `\\${match}`);

const buildWhere = (q: ListPersonalInformationQuery): SQL | undefined => {
  const predicates: SQL[] = [];
  if (q.id) predicates.push(eq(personalInformation.id, q.id));
  if (q.blobId) predicates.push(eq(personalInformation.blobId, q.blobId));

  if (q.search) {
    const pattern = `%${escapeLike(q.search.toLowerCase())}%`;
    predicates.push(
      or(
        ilike(personalInformation.fullName, pattern),
        ilike(personalInformation.phoneNumber, pattern),
      ) as SQL,
    );
  }

  const likeFilters: Array<[AnyPgColumn, string | undefined]> = [
    [personalInformation.fullName, q.fullName],
    [personalInformation.phoneNumber, q.phoneNumber],
  ];
  for (const [column, value] of likeFilters) {
    if (value) predicates.push(ilike(column, `%${escapeLike(value.toLowerCase())}%`));
  }

  return predicates.length > 0 ? and(...predicates) : undefined;
};

@Injectable()
export class PersonalInformationService {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDb) {}

  async create(dto: CreatePersonalInformationInput): Promise<PersonalInformation> {
    const rows = await this.db.insert(personalInformation).values(dto).returning();
    const created = rows[0];
    if (!created) throw new Error('Personal information insert returned no row');
    return created;
  }

  async list(
    query: ListPersonalInformationQuery,
  ): Promise<PaginatedResponseDto<PersonalInformation>> {
    const where = buildWhere(query);
    const orderBy =
      query.sortDirection === 'asc'
        ? asc(sortColumns[query.sortBy])
        : desc(sortColumns[query.sortBy]);

    const [rows, countRows] = await Promise.all([
      this.db
        .select()
        .from(personalInformation)
        .where(where)
        .orderBy(orderBy)
        .limit(query.size)
        .offset(query.page * query.size),
      this.db
        .select({ total: sql`count(*)`.mapWith(Number) })
        .from(personalInformation)
        .where(where),
    ]);

    const total = countRows[0]?.total ?? 0;
    return new PaginatedResponseDto(
      rows,
      total,
      Math.ceil(total / query.size),
      query.page,
      query.size,
    );
  }

  async update(id: string, patch: UpdatePersonalInformationInput): Promise<PersonalInformation> {
    if (Object.keys(patch).length === 0) {
      const rows = await this.db
        .select()
        .from(personalInformation)
        .where(eq(personalInformation.id, id))
        .limit(1);
      const existing = rows[0];
      if (!existing) throw new NotFoundException(`PersonalInformation with id '${id}' not found`);
      return existing;
    }
    const rows = await this.db
      .update(personalInformation)
      .set(patch)
      .where(eq(personalInformation.id, id))
      .returning();
    const updated = rows[0];
    if (!updated) throw new NotFoundException(`PersonalInformation with id '${id}' not found`);
    return updated;
  }

  async remove(id: string): Promise<void> {
    const rows = await this.db
      .delete(personalInformation)
      .where(eq(personalInformation.id, id))
      .returning({ id: personalInformation.id });
    if (!rows[0]) throw new NotFoundException(`PersonalInformation with id '${id}' not found`);
  }
}
