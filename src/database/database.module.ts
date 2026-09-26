import { Global, Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { setDefaultResultOrder } from 'node:dns';
import { setDefaultAutoSelectFamilyAttemptTimeout } from 'node:net';
import { Pool } from 'pg';
import { DatabaseService } from './database.service.js';
import { DbHealthController } from './db-health.controller.js';
import { DRIZZLE, PG_POOL } from './database.constants.js';

@Global()
@Module({
  controllers: [DbHealthController],
  providers: [
    {
      provide: PG_POOL,
      inject: [ConfigService],
      useFactory: (config: ConfigService): Pool => {
        // VPN/corporate DNS returns dead AAAA first; prefer IPv4.
        setDefaultResultOrder('ipv4first');
        setDefaultAutoSelectFamilyAttemptTimeout(2000);
        const pool = new Pool({
          connectionString: config.getOrThrow<string>('DATABASE_URL'),
          ssl: { rejectUnauthorized: true },
          max: 5,
          idleTimeoutMillis: 30_000,
          connectionTimeoutMillis: 5_000,
          query_timeout: 5_000,
          keepAlive: true,
          keepAliveInitialDelayMillis: 10_000,
          application_name: 'ipref-api',
        });
        pool.on('error', err => new Logger('PgPool').error(err.message));
        return pool;
      },
    },
    {
      provide: DRIZZLE,
      inject: [PG_POOL],
      useFactory: (pool: Pool): NodePgDatabase => drizzle(pool),
    },
    DatabaseService,
  ],
  exports: [PG_POOL, DRIZZLE, DatabaseService],
})
export class DatabaseModule {}
