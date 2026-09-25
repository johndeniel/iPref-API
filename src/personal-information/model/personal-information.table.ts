import { index, pgTable, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';

export const personalInformation = pgTable(
  'personal_information',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // Managed Neon Auth user id (JWT `sub`). One profile per user.
    userId: text('user_id').notNull().unique(),
    fullName: varchar('full_name', { length: 255 }).notNull(),
    blobUrl: text('blob_url'),
    blobId: uuid('blob_id'),
    phoneNumber: varchar('phone_number', { length: 20 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  table => [
    index('idx_pi_user_id').on(table.userId),
    index('idx_pi_full_name').on(table.fullName),
    index('idx_pi_phone_number').on(table.phoneNumber),
    index('idx_pi_blob_id').on(table.blobId),
  ],
);

export type PersonalInformationRow = typeof personalInformation.$inferSelect;
export type NewPersonalInformationRow = typeof personalInformation.$inferInsert;
