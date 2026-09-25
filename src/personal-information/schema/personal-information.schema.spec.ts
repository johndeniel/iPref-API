import {
  createPersonalInformationSchema,
  listPersonalInformationQuerySchema,
  updatePersonalInformationSchema,
} from './personal-information.schema.js';

describe('personal-information schema (single source of truth)', () => {
  it('requires full name, rejecting blanks', () => {
    expect(createPersonalInformationSchema.safeParse({}).success).toBe(false);
    expect(createPersonalInformationSchema.safeParse({ fullName: '   ' }).success).toBe(false);
    expect(createPersonalInformationSchema.safeParse({ fullName: 'Ada Lovelace' }).success).toBe(
      true,
    );
  });

  it('enforces lengths from the table and formats for url/uuid', () => {
    const long = 'x'.repeat(256);
    expect(createPersonalInformationSchema.safeParse({ fullName: long }).success).toBe(false);
    expect(
      createPersonalInformationSchema.safeParse({
        fullName: 'Ada Lovelace',
        blobUrl: 'not-a-url',
      }).success,
    ).toBe(false);
    expect(
      createPersonalInformationSchema.safeParse({
        fullName: 'Ada Lovelace',
        blobId: 'not-a-uuid',
      }).success,
    ).toBe(false);
    expect(
      createPersonalInformationSchema.safeParse({
        fullName: 'Ada Lovelace',
      }).success,
    ).toBe(true);
  });

  it('allows partial updates including an empty patch', () => {
    expect(updatePersonalInformationSchema.safeParse({}).success).toBe(true);
    expect(updatePersonalInformationSchema.safeParse({ fullName: 'Ada Lovelace' }).success).toBe(
      true,
    );
  });

  it('rejects unknown fields in create/update bodies instead of stripping them', () => {
    expect(
      createPersonalInformationSchema.safeParse({ fullName: 'Ada Lovelace', title: 'Dr' }).success,
    ).toBe(false);
    expect(
      updatePersonalInformationSchema.safeParse({ fullName: 'Ada Lovelace', title: 'Dr' }).success,
    ).toBe(false);
  });

  it('defaults pagination/sort and coerces query-string numbers', () => {
    const parsed = listPersonalInformationQuerySchema.safeParse({});
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data).toMatchObject({
        page: 0,
        size: 10,
        sortBy: 'createdAt',
        sortDirection: 'desc',
      });
    }
    const coerced = listPersonalInformationQuerySchema.safeParse({ page: '2', size: '25' });
    expect(coerced.success).toBe(true);
    if (coerced.success) {
      expect(coerced.data.page).toBe(2);
      expect(coerced.data.size).toBe(25);
    }
  });

  it('rejects unknown sort fields instead of silently falling back', () => {
    expect(listPersonalInformationQuerySchema.safeParse({ sortBy: 'nope' }).success).toBe(false);
  });
});
