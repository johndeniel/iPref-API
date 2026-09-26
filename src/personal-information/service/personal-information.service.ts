import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, ilike, or, sql, type SQL } from 'drizzle-orm';
import {
  containsFilter,
  escapeLike,
  listPaginated,
  type Paginated,
} from '../../common/pagination.js';
import { DRIZZLE } from '../../database/database.constants.js';
import type { DrizzleDb } from '../../database/drizzle.types.js';
import {
  personalInformation,
  personalInformationSortColumns,
  type CreatePersonalInformationInput,
  type ListPersonalInformationQuery,
  type PersonalInformation,
  type UpdatePersonalInformationInput,
} from '../model/personal-information.model.js';
import { ProfileProvisioningService } from '../provisioning/profile-provisioning.service.js';

const isUniqueViolation = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  'code' in error &&
  (error as { code?: unknown }).code === '23505';

const buildWhere = (userId: string, q: ListPersonalInformationQuery): SQL => {
  const predicates: SQL[] = [eq(personalInformation.userId, userId)];
  if (q.id) predicates.push(eq(personalInformation.id, q.id));
  if (q.fullName) predicates.push(containsFilter(personalInformation.fullName, q.fullName));

  // Global search: case-insensitive substring across id (as text) and full name.
  if (q.search) {
    const pattern = `%${escapeLike(q.search)}%`;
    predicates.push(
      or(
        sql`${personalInformation.id}::text ILIKE ${pattern}`,
        ilike(personalInformation.fullName, pattern),
      )!,
    );
  }

  return and(...predicates)!;
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
  ): Promise<Paginated<PersonalInformation>> {
    await this.provisioning.ensureProvisioned({ id: userId });
    return listPaginated(this.db, {
      table: personalInformation,
      where: buildWhere(userId, query),
      query,
      sortColumns: personalInformationSortColumns,
    });
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
