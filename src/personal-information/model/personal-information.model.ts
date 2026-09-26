// One definition drives everything: the table sets the storage rules, the
// request validation is generated from it, and the database rejects anything
// that slips through.

import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { index, pgTable, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';
import { createInsertSchema, createSelectSchema } from 'drizzle-zod';
import { z } from 'zod';
import { pageEnvelope } from '../../common/pagination.js';

// Only user_id is indexed — it serves the ownership and provisioning lookups
// (and is unique). No indexes on full_name/phone_number/blob_id: those are
// only matched with `%term%` searches, and a btree index can't speed up a
// term that starts with a wildcard.
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

// Request bodies reject unknown fields (400); URL filters stay lenient.
// userId always comes from the verified login token — clients can never set
// it. Optional columns accept null or missing to match the table.
export const createPersonalInformationSchema = createInsertSchema(personalInformation, {
  fullName: z.string().trim().min(1, 'Full name is required').max(255),
  blobUrl: z.url('Blob URL must be a valid URL').max(2048).nullish(),
  blobId: z.uuid().nullish(),
  phoneNumber: z
    .string()
    .trim()
    .max(20)
    .regex(
      /^(?:\+63[\s-]?|0)9(?:[\s-]?\d){9}$/,
      'Philippine mobile number: 09XXXXXXXXX or +639XXXXXXXXX (spaces/dashes allowed)',
    )
    .nullish(),
})
  .omit({ id: true, userId: true, createdAt: true, updatedAt: true })
  .strict();

export const updatePersonalInformationSchema = createPersonalInformationSchema.partial().strict();

// Allowed sort fields: this map is both the `sortBy` options and the column
// lookup, so a request can never sort by an unlisted column.
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

// URL filter contract: the field order below sets the parameter order in
// Swagger UI. `search` looks across columns; `fullName` filters that one field.
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
