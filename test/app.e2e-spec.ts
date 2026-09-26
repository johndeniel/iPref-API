import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import request from 'supertest';
import { AppModule } from './../src/app.module.js';

describe('Health (e2e)', () => {
  let app: INestApplication;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  it('/health (GET)', () => {
    return request(app.getHttpServer() as Server)
      .get('/health')
      .expect(200)
      .expect((res: { body: { status: unknown; timestamp: unknown } }) => {
        expect(res.body.status).toBe('ok');
        expect(typeof res.body.timestamp).toBe('string');
      });
  });

  afterEach(async () => {
    await app.close();
  });
});
