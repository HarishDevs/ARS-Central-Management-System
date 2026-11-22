// Types for scripts/database/arsbak.js (the .arsbak package format, D-408).
export type PackageSecret = { passphrase: string } | { serverKey: Buffer } | { key: Buffer };
export interface WriterState {
  frameIndex: number;
  size: number;
}
export interface ReaderPosition {
  frameOffset: number;
  frameIndex: number;
  skip: number;
}
export interface PackageEntry {
  name: string;
  meta: Record<string, unknown> & { n: string; size: number };
  data: Buffer;
  hash: string;
  position: ReaderPosition;
}
export const MAGIC: Buffer;
export const FORMAT_VERSION: number;
export const KDF_DEFAULT: { N: number; r: number; p: number };
export const FRAME_TARGET: number;
export const MAX_ENTRY: number;
export const MIN_PASSPHRASE: number;
export class PackageError extends Error {
  code: "NOT_PACKAGE" | "DAMAGED" | "TRUNCATED" | "WRONG_PASSPHRASE" | "WRONG_SERVER_KEY" | "PASSPHRASE_NEEDED" | "SERVER_KEY_NEEDED" | "WEAK_PASSPHRASE";
}
export class PackageWriter {
  readonly file: string;
  readonly key: Buffer;
  readonly kdf: "scrypt" | "server-key";
  readonly size: number;
  static create(file: string, secret: { passphrase: string } | { serverKey: Buffer }, options?: { kdf?: { N: number; r: number; p: number } }): Promise<PackageWriter>;
  static resume(file: string, key: Buffer, state: WriterState): Promise<PackageWriter>;
  add(name: string, data: Buffer | string | object, extra?: Record<string, unknown>): Promise<{ hash: string; size: number }>;
  checkpoint(): Promise<WriterState>;
  finish(manifest: object): Promise<WriterState>;
  close(): Promise<void>;
}
export class PackageReader {
  readonly key: Buffer;
  readonly kdf: "scrypt" | "server-key";
  static readHeader(file: string): Promise<{ header: { v: number; kdf: { alg: "scrypt" | "server-key"; id?: string } }; bytes: Buffer }>;
  static open(file: string, secret: PackageSecret): Promise<PackageReader>;
  entries(from?: ReaderPosition | null): AsyncGenerator<PackageEntry>;
  close(): Promise<void>;
}
export function passphraseProblem(passphrase: string): string | null;
export function keyFromText(text: string): Buffer | null;
export function serverKeyId(serverKey: Buffer): string;
export function fileSha256(file: string): Promise<string>;
export function readHead(file: string, secret: PackageSecret): Promise<{ head: Record<string, unknown>; key: Buffer; kdf: "scrypt" | "server-key" }>;
