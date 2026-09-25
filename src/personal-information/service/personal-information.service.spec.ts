import { ConflictException, NotFoundException } from '@nestjs/common';
import type { DrizzleDb } from '../../database/drizzle.types.js';
import type { ProfileProvisioningService } from '../provisioning/profile-provisioning.service.js';
import type { PersonalInformation } from '../schema/personal-information.schema.js';
import { PersonalInformationService } from './personal-information.service.js';

const USER_ID = 'user-1';

const row = (overrides: Partial<PersonalInformation> = {}): PersonalInformation => ({
  id: '11111111-1111-4111-8111-111111111111',
  userId: USER_ID,
  fullName: 'Ada Lovelace',
  blobUrl: null,
  blobId: null,
  phoneNumber: null,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-02T00:00:00.000Z'),
  ...overrides,
});

const listQuery = {
  page: 0,
  size: 10,
  sortBy: 'createdAt',
  sortDirection: 'desc',
} as const;

/** select().from().where().limit() chain resolving to `rows`. */
const selectRows = (rows: unknown[]) => {
  const limit = vi.fn().mockResolvedValue(rows);
  const where = vi.fn().mockReturnValue({ limit });
  const from = vi.fn().mockReturnValue({ where });
  return vi.fn().mockReturnValue({ from });
};

const provisioning = () =>
  ({
    ensureProvisioned: vi.fn().mockResolvedValue(undefined),
  }) as unknown as ProfileProvisioningService;

describe('PersonalInformationService', () => {
  beforeEach(() => vi.clearAllMocks());

  it('creates by inserting the dto with the owner userId', async () => {
    const returning = vi.fn().mockResolvedValue([row()]);
    const values = vi.fn().mockReturnValue({ returning });
    const insert = vi.fn().mockReturnValue({ values });
    const db = { select: selectRows([]), insert } as unknown as DrizzleDb;
    const service = new PersonalInformationService(db, provisioning());

    const created = await service.create(USER_ID, { fullName: 'Ada Lovelace' });

    expect(insert).toHaveBeenCalledOnce();
    expect(values).toHaveBeenCalledWith({ fullName: 'Ada Lovelace', userId: USER_ID });
    expect(created.id).toBe('11111111-1111-4111-8111-111111111111');
  });

  it('rejects create with 409 when the user already owns a row', async () => {
    const db = { select: selectRows([row()]) } as unknown as DrizzleDb;
    const service = new PersonalInformationService(db, provisioning());

    await expect(service.create(USER_ID, { fullName: 'Ada Lovelace' })).rejects.toThrow(
      ConflictException,
    );
  });

  it('lists with limit/offset derived from page/size and maps pagination', async () => {
    const offset = vi.fn().mockResolvedValue([row()]);
    const limit = vi.fn().mockReturnValue({ offset });
    const orderBy = vi.fn().mockReturnValue({ limit });
    const whereRows = vi.fn().mockReturnValue({ orderBy });
    const fromRows = vi.fn().mockReturnValue({ where: whereRows });
    const whereCount = vi.fn().mockResolvedValue([{ total: 1 }]);
    const fromCount = vi.fn().mockReturnValue({ where: whereCount });
    const select = vi
      .fn()
      .mockReturnValueOnce({ from: fromRows })
      .mockReturnValueOnce({ from: fromCount });
    const db = { select } as unknown as DrizzleDb;
    const service = new PersonalInformationService(db, provisioning());

    const page = await service.list(USER_ID, { ...listQuery });

    expect(select).toHaveBeenCalledTimes(2);
    expect(limit).toHaveBeenCalledWith(10);
    expect(offset).toHaveBeenCalledWith(0);
    expect(page.content).toHaveLength(1);
    expect(page.totalElements).toBe(1);
    expect(page.totalPages).toBe(1);
    expect(page.page).toBe(0);
    expect(page.size).toBe(10);
  });

  it('updates with a single returning query (no pre-find)', async () => {
    const returning = vi.fn().mockResolvedValue([row({ fullName: 'Ada L.' })]);
    const where = vi.fn().mockReturnValue({ returning });
    const set = vi.fn().mockReturnValue({ where });
    const update = vi.fn().mockReturnValue({ set });
    const db = { select: selectRows([]), update } as unknown as DrizzleDb;
    const service = new PersonalInformationService(db, provisioning());

    const updated = await service.update(USER_ID, '11111111-1111-4111-8111-111111111111', {
      fullName: 'Ada L.',
    });

    expect(update).toHaveBeenCalledOnce();
    expect(set).toHaveBeenCalledWith({ fullName: 'Ada L.' });
    expect(updated.fullName).toBe('Ada L.');
  });

  it('throws 404 when update returns nothing', async () => {
    const returning = vi.fn().mockResolvedValue([]);
    const where = vi.fn().mockReturnValue({ returning });
    const set = vi.fn().mockReturnValue({ where });
    const update = vi.fn().mockReturnValue({ set });
    const db = { select: selectRows([]), update } as unknown as DrizzleDb;
    const service = new PersonalInformationService(db, provisioning());

    await expect(
      service.update(USER_ID, '22222222-2222-4222-8222-222222222222', { fullName: 'Ada L.' }),
    ).rejects.toThrow(NotFoundException);
  });

  it('treats an empty patch as a no-op fetch (never calls update)', async () => {
    const limit = vi.fn().mockResolvedValue([row()]);
    const where = vi.fn().mockReturnValue({ limit });
    const from = vi.fn().mockReturnValue({ where });
    const select = vi.fn().mockReturnValue({ from });
    const update = vi.fn();
    const db = { select, update } as unknown as DrizzleDb;
    const service = new PersonalInformationService(db, provisioning());

    const result = await service.update(USER_ID, '11111111-1111-4111-8111-111111111111', {});

    expect(update).not.toHaveBeenCalled();
    expect(result.id).toBe('11111111-1111-4111-8111-111111111111');
  });

  it('deletes with a single query and throws 404 when nothing was deleted', async () => {
    const returning = vi.fn().mockResolvedValue([{ id: '11111111-1111-4111-8111-111111111111' }]);
    const where = vi.fn().mockReturnValue({ returning });
    const del = vi.fn().mockReturnValue({ where });
    const db = { select: selectRows([]), delete: del } as unknown as DrizzleDb;
    const service = new PersonalInformationService(db, provisioning());

    await service.remove(USER_ID, '11111111-1111-4111-8111-111111111111');
    expect(del).toHaveBeenCalledOnce();

    returning.mockResolvedValue([]);
    await expect(service.remove(USER_ID, '22222222-2222-4222-8222-222222222222')).rejects.toThrow(
      NotFoundException,
    );
  });
});
