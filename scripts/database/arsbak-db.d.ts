// Types for scripts/database/arsbak-db.js (D-408).
import type { Connection } from "mysql2/promise";

export const EXCLUDED_TABLES: ReadonlySet<string>;
export const STAGE: string;
export const OLD: string;
export const PAGE_ROWS: number;
export function quoteId(name: string): string;
export function sqlValue(value: unknown): string;
export function openConnection(config: { host: string; port: number; user: string; password: string; database: string; connectTimeout?: number; ssl?: unknown }): Promise<Connection>;
export function connectionFromEnv(env?: Record<string, string | undefined>): Promise<Connection>;
export function listTables(connection: Connection): Promise<{ name: string; estimate: number }[]>;
export function exactCount(connection: Connection, table: string): Promise<number>;
export function appliedMigrations(connection: Connection): Promise<string[]>;
export function splitConstraints(createSql: string): { sql: string; constraints: string[] };
export function stageName(table: string): string;
export function oldName(table: string): string;
export function dropStaging(connection: Connection): Promise<number>;
export function rekeyEncrypted(connection: Connection, fromKey: Buffer, toKey: Buffer, tables?: string[] | null): Promise<{ values: number }>;
export function tryDecrypt(encoded: string, key: Buffer): Buffer | null;
export function encryptWith(plaintext: Buffer, key: Buffer): string;
