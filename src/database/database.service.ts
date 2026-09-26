import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import type { Pool, QueryResult, QueryResultRow } from 'pg';
import { PG_POOL } from './database.constants.js';

@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DatabaseService.name);

  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.pool.query('SELECT 1');
      this.logger.log('Postgres connected');
    } catch (error) {
      throw new Error(`Postgres unreachable (VPN blocking 5432?): ${(error as Error).message}`, {
        cause: error,
      });
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }

  query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    params?: unknown[],
  ): Promise<QueryResult<T>> {
    return this.pool.query<T>(text, params);
  }

  async checkHealth(): Promise<{ ok: boolean; latencyMs: number }> {
    const started = Date.now();
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>(
      (_, reject) => (timer = setTimeout(() => reject(new Error('Postgres timeout')), 2500)),
    );
    try {
      await Promise.race([this.pool.query('SELECT 1'), timeout]);
      return { ok: true, latencyMs: Date.now() - started };
    } finally {
      clearTimeout(timer);
    }
  }
}
