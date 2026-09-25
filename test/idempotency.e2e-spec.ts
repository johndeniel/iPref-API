import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { eq, inArray } from 'drizzle-orm';
import request from 'supertest';
import type { App } from 'supertest/types';
import { v4 as uuidv4 } from 'uuid';
import { DRIZZLE } from './../src/database/database.constants.js';
import type { DrizzleDb } from './../src/database/drizzle.types.js';
import { idempotencyKeys } from './../src/idempotency/model/idempotency-key.table.js';
import { IdempotencyKeyRepository } from './../src/idempotency/repository/idempotency-key.repository.js';
import { personalInformation } from './../src/personal-information/model/personal-information.table.js';
import { AppModule } from './../src/app.module.js';

const key = (): string => uuidv4();

interface PersonalInformationBody {
  id: string;
  fullName?: string;
  phoneNumber?: string;
}

interface PersonalInformationListBody {
  content: unknown[];
  totalElements: number;
}

describe('Idempotency + personal-information (e2e)', () => {
  let app: INestApplication<App>;
  let db: DrizzleDb;
  let idempotencyRepo: IdempotencyKeyRepository;
  const createdIds: string[] = [];
  const usedKeys: string[] = [];

  const api = () => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    return request(app.getHttpServer());
  };
  const bodyOf = (res: { body: unknown }): PersonalInformationBody =>
    res.body as PersonalInformationBody;
  const listOf = (res: { body: unknown }): PersonalInformationListBody =>
    res.body as PersonalInformationListBody;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

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
    for (const k of usedKeys) {
      await db.delete(idempotencyKeys).where(eq(idempotencyKeys.idempotencyKey, k));
    }
    await app.close();
  }, 120_000);

  const post = (body: object, idempotencyKey?: string) => {
    const req = api().post('/v1/personal-information').send(body);
    return idempotencyKey ? req.set('Idempotency-Key', idempotencyKey) : req;
  };

  it('POST without a key is rejected with 400', async () => {
    await post({ fullName: 'Ada Lovelace' })
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
    const k = key();
    usedKeys.push(k);
    const body = { fullName: 'Ada Lovelace' };

    const first = await post(body, k).expect(201);
    expect(first.headers['idempotency-key']).toBe(k);
    createdIds.push(bodyOf(first).id);

    const replay = await post(body, k).expect(201);
    expect(replay.headers['idempotency-key']).toBe(k);
    expect(replay.body).toEqual(first.body);
  }, 90_000);

  it('a new key executes again', async () => {
    const k = key();
    usedKeys.push(k);
    const res = await post({ fullName: 'Grace Hopper' }, k).expect(201);
    createdIds.push(bodyOf(res).id);
    expect(bodyOf(res).fullName).toBe('Grace Hopper');
  }, 90_000);

  it('failed requests are never cached — the key is released for retry', async () => {
    const k = key();
    usedKeys.push(k);
    // Missing fullName → 400 from the service guard.
    await post({}, k).expect(400);
    // Same key with a valid body must execute, not replay the failure.
    const retry = await post({ fullName: 'Ada Lovelace' }, k).expect(201);
    createdIds.push(bodyOf(retry).id);
  }, 90_000);

  it('a concurrent in-progress key answers 409', async () => {
    const k = key();
    usedKeys.push(k);
    await idempotencyRepo.insert(
      { idempotencyKey: k, expiresAt: new Date(Date.now() + 3_600_000) },
      db,
    );
    await post({ fullName: 'Ada Lovelace' }, k)
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
    const list = await api().get('/v1/personal-information').expect(200);
    expect(listOf(list).content).toBeInstanceOf(Array);
    expect(typeof listOf(list).totalElements).toBe('number');

    const k = key();
    usedKeys.push(k);
    const created = await post({ fullName: 'Alan Turing' }, k).expect(201);
    const id = bodyOf(created).id;
    createdIds.push(id);

    const updated = await api()
      .put(`/v1/personal-information/${id}`)
      .send({ fullName: 'Alan M. Turing' })
      .expect(200);
    expect(bodyOf(updated).fullName).toBe('Alan M. Turing');

    await api().delete(`/v1/personal-information/${id}`).expect(204);
    createdIds.splice(createdIds.indexOf(id), 1);
  }, 120_000);
});
