import { createInsertSchema, createSelectSchema } from 'drizzle-zod';
import { z } from 'zod';
import { personalInformation } from '../model/personal-information.table.js';

// Lengths come from the Drizzle table; formats/requiredness refined here.
const baseInsertSchema = createInsertSchema(personalInformation, {
  fullName: z.string().trim().min(1, 'Full name is required').max(255),
  blobUrl: z.url('Blob URL must be a valid URL').max(2048).optional(),
  blobId: z.uuid().optional(),
});

// Strict bodies (unknown fields → 400); query filters stay lenient.
// userId is server-set from the verified JWT — never client-supplied.
export const createPersonalInformationSchema = baseInsertSchema
  .omit({
    id: true,
    userId: true,
    createdAt: true,
    updatedAt: true,
  })
  .strict();

export const updatePersonalInformationSchema = createPersonalInformationSchema.partial().strict();

export const PERSONAL_INFORMATION_SORT_FIELDS = [
  'fullName',
  'phoneNumber',
  'createdAt',
  'updatedAt',
] as const;

export const listPersonalInformationQuerySchema = z.object({
  page: z.coerce.number().int().min(0).default(0),
  size: z.coerce.number().int().min(1).max(100).default(10),
  sortBy: z.enum(PERSONAL_INFORMATION_SORT_FIELDS).default('createdAt'),
  sortDirection: z.enum(['asc', 'desc']).default('desc'),
  id: z.uuid().optional(),
  blobId: z.uuid().optional(),
  search: z.string().trim().max(255).optional(),
  fullName: z.string().trim().max(255).optional(),
  phoneNumber: z.string().trim().max(20).optional(),
});

export const personalInformationSelectSchema = createSelectSchema(personalInformation);

export type CreatePersonalInformationInput = z.infer<typeof createPersonalInformationSchema>;
export type UpdatePersonalInformationInput = z.infer<typeof updatePersonalInformationSchema>;
export type ListPersonalInformationQuery = z.infer<typeof listPersonalInformationQuerySchema>;
export type PersonalInformationSortField = (typeof PERSONAL_INFORMATION_SORT_FIELDS)[number];
export type PersonalInformation = typeof personalInformation.$inferSelect;
