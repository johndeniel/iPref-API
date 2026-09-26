// Single source of truth for the personal_information row: the Drizzle table
// defines storage (lengths, nullability, defaults), drizzle-zod derives
// validation from it, extras are refined here. The DB rejects what slips past.

import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { index, pgTable, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';
import { createInsertSchema, createSelectSchema } from 'drizzle-zod';
import { z } from 'zod';
import { pageEnvelope } from '../../common/pagination.js';

// Indexes: only user_id (ownership/provisioning lookups; also unique).
// Deliberately NO btree on full_name/phone_number/blob_id — every filter on
// them is a %term% ILIKE (btree can't serve leading wildcards) or unused.
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
  table => [index('idx_pi_user_id').on(table.userId)],
);

// Strict bodies (unknown fields → 400); query filters stay lenient.
// userId is server-set from the verified JWT — never client-supplied.
// Nullable columns are nullish so bodies match the table exactly.
export const createPersonalInformationSchema = createInsertSchema(personalInformation, {
  fullName: z.string().trim().min(1, 'Full name is required').max(255),
  blobUrl: z.url('Blob URL must be a valid URL').max(2048).nullish(),
  blobId: z.uuid().nullish(),
  phoneNumber: z.string().trim().max(20).nullish(),
})
  .omit({ id: true, userId: true, createdAt: true, updatedAt: true })
  .strict();

export const updatePersonalInformationSchema = createPersonalInformationSchema.partial().strict();

// Sort whitelist: this one map is both the `sortBy` enum and the ORDER BY
// column lookup, so user input can never reach a column that isn't listed.
export const personalInformationSortColumns = {
  fullName: personalInformation.fullName,
  createdAt: personalInformation.createdAt,
  updatedAt: personalInformation.updatedAt,
} satisfies Record<string, AnyPgColumn>;

export type PersonalInformationSortField = keyof typeof personalInformationSortColumns;

const SORT_FIELDS = Object.keys(personalInformationSortColumns) as [
  PersonalInformationSortField,
  ...PersonalInformationSortField[],
];

// Query contract: key order below IS the Swagger UI parameter order
// (consumed by ApiZodQuery). `search` = multi-column text search;
// `fullName` = dedicated per-field contains filter.
export const listPersonalInformationQuerySchema = z.object({
  search: z
    .string()
    .trim()
    .max(255)
    .optional()
    .describe('Search across ID and name, case-insensitive.'),
  id: z.uuid().optional().describe('Exact profile ID (UUID).'),
  fullName: z
    .string()
    .trim()
    .max(255)
    .optional()
    .describe('Substring filter on full name, case-insensitive.'),
  sortBy: z.enum(SORT_FIELDS).default('createdAt').describe('Field to sort by.'),
  sortDirection: z.enum(['asc', 'desc']).default('desc').describe('Sort direction.'),
  size: z.coerce.number().int().min(1).max(100).default(10).describe('Page size, 1-100.'),
  page: z.coerce.number().int().min(0).default(0).describe('Page number, zero-indexed.'),
});

// Response contract (Swagger only; runtime rows come straight from Drizzle).
export const paginatedPersonalInformationSchema = pageEnvelope(
  createSelectSchema(personalInformation),
);

export type PersonalInformation = typeof personalInformation.$inferSelect;
export type CreatePersonalInformationInput = z.infer<typeof createPersonalInformationSchema>;
export type UpdatePersonalInformationInput = z.infer<typeof updatePersonalInformationSchema>;
export type ListPersonalInformationQuery = z.infer<typeof listPersonalInformationQuerySchema>;
