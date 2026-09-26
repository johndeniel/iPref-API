import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DatabaseService } from '../../database/database.service.js';
import { DRIZZLE } from '../../database/database.constants.js';
import type { DrizzleDb } from '../../database/drizzle.types.js';
import type { AuthenticatedUser } from '../../auth/auth.types.js';
import { personalInformation } from '../model/personal-information.model.js';

export interface WebhookUser {
  id: string;
  name?: string | null;
  email?: string | null;
  image?: string | null;
}

interface NeonAuthUserRow {
  name: string | null;
  email: string | null;
  image: string | null;
}

/**
 * Owns the Neon Auth user → `personal_information` link.
 *
 * Two provisioning paths share this service:
 * - eager: the `user.created` webhook (primary);
 * - lazy: `ensureProvisioned` on first authenticated touch (self-healing
 *   fallback for missed webhooks and local dev without a public URL).
 *
 * All writes are idempotent (`user_id` is unique + `ON CONFLICT DO NOTHING`),
 * so webhook redeliveries and concurrent first requests are safe.
 */
@Injectable()
export class ProfileProvisioningService {
  private readonly logger = new Logger(ProfileProvisioningService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDb,
    private readonly database: DatabaseService,
  ) {}

  async provisionFromWebhook(user: WebhookUser): Promise<void> {
    const fullName = user.name?.trim() || user.email?.trim();
    if (!user.id || !fullName) {
      throw new BadRequestException('Webhook user has no id or name/email');
    }
    await this.db
      .insert(personalInformation)
      .values({ userId: user.id, fullName, blobUrl: user.image ?? null })
      .onConflictDoNothing({ target: personalInformation.userId });
    this.logger.log(`Provisioned profile for user_id=${user.id} (webhook)`);
  }

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
    this.logger.log(`Provisioned profile for user_id=${identity.id} (lazy)`);
  }

  /**
   * The `neon_auth` schema lives in the same database (managed Better Auth),
   * so the profile name/image can be read directly — no extra HTTP call.
   * `id::text` comparison tolerates any `sub` string shape.
   */
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
