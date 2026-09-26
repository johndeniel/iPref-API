import { UnauthorizedException, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { eq, inArray } from 'drizzle-orm';
import type { Server } from 'node:http';
import request from 'supertest';
import { v4 as uuidv4 } from 'uuid';
import { AuthService } from './../src/auth/auth.service.js';
import { DRIZZLE } from './../src/database/database.constants.js';
import type { DrizzleDb } from './../src/database/drizzle.types.js';
import { idempotencyKeys } from './../src/idempotency/model/idempotency-key.table.js';
import { IdempotencyKeyRepository } from './../src/idempotency/repository/idempotency-key.repository.js';
import { personalInformation } from './../src/personal-information/model/personal-information.model.js';
import { AppModule } from './../src/app.module.js';

const key = (): string => uuidv4();

// Offline stand-in for Managed Neon Auth: any `e2e-*` token maps to a
// distinct test user. The guard contract itself is covered by unit tests +
// the auth e2e. Fresh users per test keep profile auto-provisioning isolated.
const userToken = (): string => `e2e-${uuidv4()}`;

interface PersonalInformationBody {
  id: string;
  userId?: string;
  fullName?: string;
  phoneNumber?: string;
}

interface PersonalInformationListBody {
  content: unknown[];
  totalElements: number;
}

describe('Idempotency + personal-information (e2e)', () => {
  let app: INestApplication;
  let db: DrizzleDb;
  let idempotencyRepo: IdempotencyKeyRepository;
  const createdIds: string[] = [];
  const usedKeys: string[] = [];
  const usedUsers: string[] = [];

  const api = () => {
    return request(app.getHttpServer() as Server);
  };

  const freshUser = (): string => {
    const token = userToken();
    usedUsers.push(token);
    return token;
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(AuthService)
      .useValue({
        // AuthService reads options at construction (lazy JWKS, no network).
        options: { jwksUrl: 'https://localhost/.well-known/jwks.json' },
        verifyBearer: (token: string) => {
          if (!token.startsWith('e2e-')) return Promise.reject(new UnauthorizedException());
          return Promise.resolve({ id: token });
        },
      })
      .compile();

    app = moduleFixture.createNestApplication();
    // Mirror main.ts — the Test bootstrapper does not run it.
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();

    db = app.get<DrizzleDb>(DRIZZLE);
    idempotencyRepo = app.get(IdempotencyKeyRepository);
  }, 120_000);

  afterAll(async () => {
    if (createdIds.length > 0) {
      await db.delete(personalInformation).where(inArray(personalInformation.id, createdIds));
    }
    if (usedUsers.length > 0) {
      await db.delete(personalInformation).where(inArray(personalInformation.userId, usedUsers));
    }
    for (const k of usedKeys) {
      await db.delete(idempotencyKeys).where(eq(idempotencyKeys.idempotencyKey, k));
    }
    await app.close();
  }, 120_000);

  const post = (token: string, body: object, idempotencyKey?: string) => {
    let req = api()
      .post('/v1/personal-information')
      .send(body)
      .set('Authorization', `Bearer ${token}`);
    if (idempotencyKey) req = req.set('Idempotency-Key', idempotencyKey);
    return req;
  };
  const authed = (token: string) => ({ Authorization: `Bearer ${token}` });

  it('POST without a key is rejected with 400', async () => {
    await post(freshUser(), { fullName: 'Ada Lovelace' })
      .expect(400)
      .expect(res => {
        expect(res.body).toMatchObject({
          status: 400,
          error: 'Bad Request',
          message: 'Missing required header: Idempotency-Key',
        });
      });
  }, 90_000);

  it('POST with a key creates once and replays byte-for-byte', async () => {
    const token = freshUser();
    const k = key();
    usedKeys.push(k);
    const body = { fullName: 'Ada Lovelace' };

    const first = await post(token, body, k).expect(201);
    expect(first.headers['idempotency-key']).toBe(k);
    createdIds.push(bodyOf(first).id);

    const replay = await post(token, body, k).expect(201);
    expect(replay.headers['idempotency-key']).toBe(k);
    expect(replay.body).toEqual(first.body);
  }, 90_000);

  it('a new key executes again', async () => {
    const k = key();
    usedKeys.push(k);
    const res = await post(freshUser(), { fullName: 'Grace Hopper' }, k).expect(201);
    createdIds.push(bodyOf(res).id);
    expect(bodyOf(res).fullName).toBe('Grace Hopper');
  }, 90_000);

  it('failed requests are never cached — the key is released for retry', async () => {
    const token = freshUser();
    const k = key();
    usedKeys.push(k);
    // Missing fullName → 400 from the service guard.
    await post(token, {}, k).expect(400);
    // Same key with a valid body must execute, not replay the failure.
    const retry = await post(token, { fullName: 'Ada Lovelace' }, k).expect(201);
    createdIds.push(bodyOf(retry).id);
  }, 90_000);

  it('a concurrent in-progress key answers 409', async () => {
    const k = key();
    usedKeys.push(k);
    await idempotencyRepo.insert(
      { idempotencyKey: k, expiresAt: new Date(Date.now() + 3_600_000) },
      db,
    );
    await post(freshUser(), { fullName: 'Ada Lovelace' }, k)
      .expect(409)
      .expect(res => {
        expect(res.body).toMatchObject({
          status: 409,
          error: 'Conflict',
          message: 'Request with this Idempotency-Key is already processing',
        });
      });
  }, 90_000);

  it('GET / PUT / DELETE work and ignore idempotency', async () => {
    const token = freshUser();
    // First touch lazily provisions the profile.
    const initial = await api().get('/v1/personal-information').set(authed(token)).expect(200);
    expect(listOf(initial).content).toHaveLength(1);

    // /me returns the same provisioned row.
    const me = await api().get('/v1/personal-information/me').set(authed(token)).expect(200);
    expect(bodyOf(me)).toMatchObject({
      id: (listOf(initial).content[0] as PersonalInformationBody).id,
      userId: token,
    });

    // Manual create 409s while the auto-provisioned row exists.
    const taken = key();
    usedKeys.push(taken);
    await post(token, { fullName: 'Alan Turing' }, taken)
      .expect(409)
      .expect(res => {
        expect(res.body).toMatchObject({
          statusCode: 409,
          message: 'Personal information already exists for this user',
        });
      });

    const row = listOf(initial).content[0] as PersonalInformationBody;
    const updated = await api()
      .put(`/v1/personal-information/${row.id}`)
      .set(authed(token))
      .send({ fullName: 'Alan M. Turing' })
      .expect(200);
    expect(bodyOf(updated).fullName).toBe('Alan M. Turing');

    await api().delete(`/v1/personal-information/${row.id}`).set(authed(token)).expect(204);

    // A deleted profile can be re-created manually.
    const k = key();
    usedKeys.push(k);
    const recreated = await post(token, { fullName: 'Alan Turing' }, k).expect(201);
    createdIds.push(bodyOf(recreated).id);
  }, 120_000);
});

const bodyOf = (res: { body: unknown }): PersonalInformationBody =>
  res.body as PersonalInformationBody;
const listOf = (res: { body: unknown }): PersonalInformationListBody =>
  res.body as PersonalInformationListBody;
