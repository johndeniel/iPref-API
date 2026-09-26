// What this file does: every signed-up user gets exactly one row in
// personal_information — never two, never overwritten. The row is created on
// the user's first API call, from the signup record in this same database.

import { Inject, Injectable, Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DatabaseService } from '../../database/database.service.js';
import { DRIZZLE } from '../../database/database.constants.js';
import type { DrizzleDb } from '../../database/drizzle.types.js';
import type { AuthenticatedUser } from '../../auth/auth.types.js';
import { personalInformation } from '../model/personal-information.model.js';

interface NeonAuthUserRow {
  name: string | null;
  email: string | null;
  image: string | null;
}

/**
 * Links a Neon Auth user to their personal_information row.
 *
 * The write ignores duplicates (user_id is unique), so simultaneous first
 * requests are safe.
 */
@Injectable()
export class ProfileProvisioningService {
  private readonly logger = new Logger(ProfileProvisioningService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDb,
    private readonly database: DatabaseService,
  ) {}

  // Fallback checked before every read/update. Row exists → return it
  // untouched. Missing → build it from the signup record (name, else email,
  // else account id) and insert it.
  async ensureProvisioned(identity: AuthenticatedUser): Promise<void> {
    const existing = await this.db
      .select({ id: personalInformation.id })
      .from(personalInformation)
      .where(eq(personalInformation.userId, identity.id))
      .limit(1);
    if (existing[0]) return;

    const authUser = await this.readNeonAuthUser(identity.id);
    const fullName =
      authUser?.name?.trim() || authUser?.email?.trim() || identity.email?.trim() || identity.id;
    await this.db
      .insert(personalInformation)
      .values({ userId: identity.id, fullName, blobUrl: authUser?.image ?? null })
      .onConflictDoNothing({ target: personalInformation.userId });
    this.logger.log(`Provisioned profile for user_id=${identity.id}`);
  }

  // Reads the user's name and photo from the signup tables in this same
  // database (no extra network call). Returns undefined on failure — the row
  // is still created, just without name/photo.
  private async readNeonAuthUser(userId: string): Promise<NeonAuthUserRow | undefined> {
    try {
      const result = await this.database.query<NeonAuthUserRow>(
        'SELECT name, email, image FROM neon_auth."user" WHERE id::text = $1 LIMIT 1',
        [userId],
      );
      return result.rows[0];
    } catch (error) {
      this.logger.warn(`neon_auth.user lookup failed: ${(error as Error).message}`);
      return undefined;
    }
  }
}
