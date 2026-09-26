import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import request from 'supertest';
import { v4 as uuidv4 } from 'uuid';
import { AppModule } from './../src/app.module.js';

/**
 * Managed Neon Auth boundaries with the real module wired in:
 * open routes stay open, guarded routes 401 without a parsable token.
 * Tokens that fail local parsing never reach the JWKS endpoint, so this
 * suite needs no network beyond the database (mirrors the idempotency e2e).
 */
describe('Auth boundaries (e2e)', () => {
  let app: INestApplication;

  const api = () => {
    return request(app.getHttpServer() as Server);
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    // Mirror main.ts — the Test bootstrapper does not run it.
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();
  }, 120_000);

  afterAll(async () => {
    await app.close();
  }, 120_000);

  it('leaves /health and /health/db open', async () => {
    await api().get('/health').expect(200);
    await api().get('/health/db').expect(200);
  }, 90_000);

  it('401s guarded routes without a token', async () => {
    await api()
      .post('/v1/personal-information')
      .set('Idempotency-Key', uuidv4())
      .send({ fullName: 'Ada Lovelace' })
      .expect(401);
    await api().get('/v1/personal-information').expect(401);
  }, 90_000);

  it('401s guarded routes with a malformed token', async () => {
    await api()
      .get('/v1/personal-information')
      .set('Authorization', 'Bearer not-a-jwt')
      .expect(401)
      .expect(res => {
        expect(res.body).toMatchObject({ statusCode: 401, message: 'Invalid or expired token' });
      });
  }, 90_000);
});
