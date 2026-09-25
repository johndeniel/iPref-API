import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq, ilike, or, sql, type SQL } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { PaginatedResponseDto } from '../../common/dto/paginated-response.dto.js';
import { DRIZZLE } from '../../database/database.constants.js';
import type { DrizzleDb } from '../../database/drizzle.types.js';
import { personalInformation } from '../model/personal-information.table.js';
import { ProfileProvisioningService } from '../provisioning/profile-provisioning.service.js';
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

const isUniqueViolation = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  'code' in error &&
  (error as { code?: unknown }).code === '23505';

const buildWhere = (userId: string, q: ListPersonalInformationQuery): SQL | undefined => {
  const predicates: SQL[] = [eq(personalInformation.userId, userId)];
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
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDb,
    private readonly provisioning: ProfileProvisioningService,
  ) {}

  /**
   * Manual creation path (local dev, re-creation after delete). Rows are
   * normally auto-provisioned on signup (webhook) or first read (lazy), so
   * this 409s when one exists. No lazy ensure here: a 400 on the first
   * attempt must stay retryable with the same idempotency key.
   */
  async create(userId: string, dto: CreatePersonalInformationInput): Promise<PersonalInformation> {
    const existing = await this.findOwned(userId, undefined);
    if (existing) {
      throw new ConflictException('Personal information already exists for this user');
    }
    try {
      const rows = await this.db
        .insert(personalInformation)
        .values({ ...dto, userId })
        .returning();
      const created = rows[0];
      if (!created) throw new Error('Personal information insert returned no row');
      return created;
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException('Personal information already exists for this user');
      }
      throw error;
    }
  }

  /**
   * Post-login "who am I": returns the caller's profile, provisioning it on
   * first touch. Never 404s under normal operation.
   */
  async getMine(userId: string): Promise<PersonalInformation> {
    await this.provisioning.ensureProvisioned({ id: userId });
    const mine = await this.findOwned(userId, undefined);
    if (!mine) throw new Error(`Provisioning failed for user_id='${userId}'`);
    return mine;
  }

  async list(
    userId: string,
    query: ListPersonalInformationQuery,
  ): Promise<PaginatedResponseDto<PersonalInformation>> {
    await this.provisioning.ensureProvisioned({ id: userId });
    const where = buildWhere(userId, query);
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

  async update(
    userId: string,
    id: string,
    patch: UpdatePersonalInformationInput,
  ): Promise<PersonalInformation> {
    await this.provisioning.ensureProvisioned({ id: userId });
    const owned = and(eq(personalInformation.id, id), eq(personalInformation.userId, userId));
    if (Object.keys(patch).length === 0) {
      const rows = await this.db.select().from(personalInformation).where(owned).limit(1);
      const existing = rows[0];
      if (!existing) throw new NotFoundException(`PersonalInformation with id '${id}' not found`);
      return existing;
    }
    const rows = await this.db.update(personalInformation).set(patch).where(owned).returning();
    const updated = rows[0];
    if (!updated) throw new NotFoundException(`PersonalInformation with id '${id}' not found`);
    return updated;
  }

  async remove(userId: string, id: string): Promise<void> {
    await this.provisioning.ensureProvisioned({ id: userId });
    const rows = await this.db
      .delete(personalInformation)
      .where(and(eq(personalInformation.id, id), eq(personalInformation.userId, userId)))
      .returning({ id: personalInformation.id });
    if (!rows[0]) throw new NotFoundException(`PersonalInformation with id '${id}' not found`);
  }

  private async findOwned(
    userId: string,
    id: string | undefined,
  ): Promise<PersonalInformation | undefined> {
    const rows = await this.db
      .select()
      .from(personalInformation)
      .where(
        id
          ? and(eq(personalInformation.id, id), eq(personalInformation.userId, userId))
          : eq(personalInformation.userId, userId),
      )
      .limit(1);
    return rows[0];
  }
}
