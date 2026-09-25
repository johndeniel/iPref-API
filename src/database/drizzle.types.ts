import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

export type DrizzleDb = NodePgDatabase;
export type DrizzleTx = Parameters<Parameters<DrizzleDb['transaction']>[0]>[0];
/** A root db handle or an in-flight transaction — repositories accept either. */
export type DrizzleClient = DrizzleDb | DrizzleTx;
