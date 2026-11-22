// Types for scripts/database/arsbak-engine.js (D-408).
import type { Connection } from "mysql2/promise";
import type { ReaderPosition, WriterState } from "./arsbak";

export type RestoreMode = "full" | "database" | "files" | "tables";
export const SECRET_ENV: readonly string[];
export const MODES: readonly RestoreMode[];
export const FILE_PIECE: number;

export interface BuildContext {
  file: string;
  secret?: { passphrase: string } | { serverKey: Buffer };
  key?: Buffer;
  connect: () => Promise<Connection>;
  uploadDir: string;
  include: { database: boolean; files: boolean; secrets: boolean };
  head: Record<string, unknown>;
  env?: Record<string, string | undefined>;
}
export interface BuildState {
  phase: "tables" | "files" | "finish" | "done";
  writer: WriterState;
  tables: string[];
  tableIndex: number;
  counts: Record<string, number>;
  fileIndex: number;
  fileTotal: number;
  fileBytes: number;
  consistent: boolean;
  progress: { done: number; total: number };
  sha256?: string;
  size?: number;
  [key: string]: unknown;
}
export function buildStep(ctx: BuildContext, state: BuildState | null, budgetMs?: number): Promise<{ state: BuildState; done: boolean; key?: Buffer }>;
export function discardBuild(file: string): Promise<void>;

export interface VerifyState {
  position: ReaderPosition | null;
  entries: number;
  bytes: number;
  counts: Record<string, number>;
  head: Record<string, unknown> | null;
  hasSecrets: boolean;
  manifest: Record<string, unknown> | null;
}
export function verifyStep(ctx: { file: string; key?: Buffer; secret?: { passphrase: string } | { serverKey: Buffer } }, state: VerifyState | null, budgetMs?: number): Promise<{ state: VerifyState; done: boolean; key: Buffer }>;
export interface PackageSummary {
  appVersion: string | null;
  createdAt: string | null;
  kind: string | null;
  source: { url?: string | null; database?: string | null } | null;
  includes: { database: boolean; files: boolean; secrets: boolean } | null;
  consistent: boolean;
  tables: { name: string; rows: number }[];
  rows: number;
  files: number;
  fileBytes: number;
  hasSecrets: boolean;
  bytes: number;
  migrationsBehind: number | null;
  migrationsAhead: number;
}
export function summarise(verified: VerifyState, appMigrations: readonly string[]): PackageSummary;

export interface RestoreContext {
  file: string;
  key: Buffer;
  connect: () => Promise<Connection>;
  uploadDir: string;
  mode: RestoreMode;
  tables?: string[];
  runId: string | number;
  sourceEncryptionKey?: Buffer | null;
  targetEncryptionKey?: Buffer | null;
}
export interface SwapState {
  moved: string[];
  restored: string[];
  external: { table: string; name: string; clause: string }[];
}
export interface RestoreState {
  phase: "load" | "swap" | "verify" | "finalize" | "done";
  position: ReaderPosition | null;
  tablesSeen: string[];
  files: number;
  swap: SwapState | null;
  warnings: string[];
  rekeyed?: number;
  triggersCreated?: number;
  manifest: Record<string, unknown> | null;
  [key: string]: unknown;
}
export function restoreStep(ctx: RestoreContext, state: RestoreState | null, budgetMs?: number): Promise<{ state: RestoreState; done: boolean }>;
export function rollbackRestore(ctx: RestoreContext, state: RestoreState | null): Promise<boolean>;
export function readSecrets(file: string, key: Buffer): Promise<{ env: Record<string, string> } | null>;
export function restoreAll(ctx: RestoreContext): Promise<RestoreState>;
export function listFiles(root: string): Promise<string[]>;
export function safeRelative(relative: string): string;
export function secretsFromEnv(env: Record<string, string | undefined>): Record<string, string>;
export function isPackageFile(file: string): boolean;
