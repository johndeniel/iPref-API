import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
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
        // High-latency / IPv6-broken egress drops pg connects under Node's
        // 250ms Happy-Eyeballs attempt timeout — allow 2s per attempt.
        setDefaultAutoSelectFamilyAttemptTimeout(2000);
        return new Pool({
          connectionString: config.getOrThrow<string>('DATABASE_URL'),
          ssl: { rejectUnauthorized: true },
        });
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
