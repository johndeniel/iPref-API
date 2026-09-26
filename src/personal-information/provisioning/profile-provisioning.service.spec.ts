import type { DatabaseService } from '../../database/database.service.js';
import type { DrizzleDb } from '../../database/drizzle.types.js';
import { ProfileProvisioningService } from './profile-provisioning.service.js';

const insertMock = () => {
  const onConflictDoNothing = vi.fn().mockResolvedValue([]);
  const values = vi.fn().mockReturnValue({ onConflictDoNothing });
  const insert = vi.fn().mockReturnValue({ values });
  return { insert, values, onConflictDoNothing };
};

const selectMock = (rows: unknown[]) => {
  const limit = vi.fn().mockResolvedValue(rows);
  const where = vi.fn().mockReturnValue({ limit });
  const from = vi.fn().mockReturnValue({ where });
  return vi.fn().mockReturnValue({ from });
};

describe('ProfileProvisioningService', () => {
  beforeEach(() => vi.clearAllMocks());

  describe('ensureProvisioned', () => {
    it('does nothing when the profile already exists', async () => {
      const query = vi.fn();
      const service = new ProfileProvisioningService(
        { select: selectMock([{ id: 'row-1' }]) } as unknown as DrizzleDb,
        { query } as unknown as DatabaseService,
      );

      await service.ensureProvisioned({ id: 'user-1' });

      expect(query).not.toHaveBeenCalled();
    });

    it('provisions from neon_auth.user on first touch', async () => {
      const { insert, values } = insertMock();
      const query = vi
        .fn()
        .mockResolvedValue({ rows: [{ name: 'Ada Lovelace', email: 'a@e.c', image: null }] });
      const service = new ProfileProvisioningService(
        { select: selectMock([]), insert } as unknown as DrizzleDb,
        { query } as unknown as DatabaseService,
      );

      await service.ensureProvisioned({ id: 'user-1' });

      expect(query).toHaveBeenCalledOnce();
      expect(values).toHaveBeenCalledWith({
        userId: 'user-1',
        fullName: 'Ada Lovelace',
        blobUrl: null,
      });
    });

    it('falls back to the JWT email when neon_auth.user has no row', async () => {
      const { values } = insertMock();
      const insert = vi.fn().mockReturnValue({ values });
      const query = vi.fn().mockResolvedValue({ rows: [] });
      const service = new ProfileProvisioningService(
        { select: selectMock([]), insert } as unknown as DrizzleDb,
        { query } as unknown as DatabaseService,
      );

      await service.ensureProvisioned({ id: 'user-1', email: 'ada@example.com' });

      expect(values).toHaveBeenCalledWith({
        userId: 'user-1',
        fullName: 'ada@example.com',
        blobUrl: null,
      });
    });

    it('survives neon_auth lookup failures via the identity fallback', async () => {
      const { values } = insertMock();
      const insert = vi.fn().mockReturnValue({ values });
      const query = vi.fn().mockRejectedValue(new Error('relation does not exist'));
      const service = new ProfileProvisioningService(
        { select: selectMock([]), insert } as unknown as DrizzleDb,
        { query } as unknown as DatabaseService,
      );

      await service.ensureProvisioned({ id: 'user-1' });

      expect(values).toHaveBeenCalledWith({
        userId: 'user-1',
        fullName: 'user-1',
        blobUrl: null,
      });
    });
  });
});
