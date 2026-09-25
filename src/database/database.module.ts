import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { setDefaultResultOrder } from 'node:dns';
import { setDefaultAutoSelectFamilyAttemptTimeout } from 'node:net';
import { Pool } from 'pg';
import { DatabaseService } from './database.service.js';
import { DbHealthController } from './db-health.controller.js';
import { DRIZZLE, PG_POOL } from './database.constants.js';

// This host's egress blackholes IPv6: the pooler resolves AAAA records that
// never answer, and pg single-homes the first address `dns.lookup` returns,
// so connects hang instead of falling back. Prefer IPv4 process-wide (v6
// remains the fallback when no A record exists).
setDefaultResultOrder('ipv4first');

@Global()
@Module({
  controllers: [DbHealthController],
  providers: [
    {
      provide: PG_POOL,
      inject: [ConfigService],
      useFactory: (config: ConfigService): Pool => {
        // High-latency egress drops pg connects under Node's 250ms
        // Happy-Eyeballs attempt timeout — allow 2s per attempt.
        setDefaultAutoSelectFamilyAttemptTimeout(2000);
        return new Pool({
          connectionString: config.getOrThrow<string>('DATABASE_URL'),
          ssl: { rejectUnauthorized: true },
          // Fail loudly instead of hanging forever on a dead route.
          connectionTimeoutMillis: 10_000,
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
