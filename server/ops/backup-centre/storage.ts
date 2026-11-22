import "server-only";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { backupDir } from "@/server/ops/backup";
import { getEnv } from "@/config/environment";
import { PackageReader } from "@/scripts/database/arsbak";

// D-408 (v1.81.0, BK-1): where packages live. Beside the daily backups, in
// <backup folder>/packages (on GoDaddy: Private Storage, /private/backups,
// kept across deploys, never in the web root). Each package has a .sha256
// (the whole file) and a .json (what it holds; no secrets) next to it.
export const PACKAGE_KINDS = ["full", "database", "safety", "scheduled", "upload", "drive", "received"] as const;
export type PackageKind = (typeof PACKAGE_KINDS)[number];
export const PACKAGE_NAME = /^ars-(full|database|safety|scheduled|upload|drive|received)-(\d{8}-\d{6})(?:-([a-z0-9]{1,12}))?\.arsbak$/;

export function packagesDir(): string {
  return path.join(backupDir(), "packages");
}
export function incomingDir(): string {
  return path.join(backupDir(), "incoming");
}
export function uploadRoot(): string {
  return path.resolve(getEnv().UPLOAD_DIR ?? path.join(process.cwd(), "storage", "uploads"));
}

export function stamp(date = new Date()): string {
  return date.toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
}

export function newPackageName(kind: PackageKind, suffix?: string): string {
  return `ars-${kind}-${stamp()}${suffix ? `-${suffix.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 12)}` : ""}.arsbak`;
}

// A name from a request → its full path, or null (never a path outside the folder).
export function packagePath(name: string): string | null {
  if (typeof name !== "string" || !PACKAGE_NAME.test(name)) return null;
  return path.join(packagesDir(), name);
}

export interface PackageMeta {
  kind: PackageKind;
  keyKind: "PASSPHRASE" | "SERVER_KEY";
  appVersion?: string | null;
  includes?: { database: boolean; files: boolean; secrets: boolean } | null;
  tables?: number;
  rows?: number;
  files?: number;
  sha256?: string;
  checked?: boolean; // a dry run read it end to end
  createdByName?: string | null;
  source?: string | null;
  deleteAfterDownload?: boolean;
}

export interface PackageInfo {
  name: string;
  bytes: number;
  createdAt: Date;
  meta: PackageMeta;
}

export async function writeMeta(name: string, meta: PackageMeta): Promise<void> {
  const file = packagePath(name);
  if (!file) throw new Error("Bad package name.");
  await fsp.writeFile(`${file}.json`, JSON.stringify(meta, null, 2), { mode: 0o600 });
}

export async function readMeta(name: string): Promise<PackageMeta | null> {
  const file = packagePath(name);
  if (!file) return null;
  try {
    return JSON.parse(await fsp.readFile(`${file}.json`, "utf8")) as PackageMeta;
  } catch {
    return null;
  }
}

// The finished packages, newest first. A package without its .json (copied in
// by hand) is still listed: the header says how it is encrypted.
export async function listPackages(): Promise<PackageInfo[]> {
  const dir = packagesDir();
  if (!fs.existsSync(dir)) return [];
  const out: PackageInfo[] = [];
  for (const name of await fsp.readdir(dir)) {
    const match = PACKAGE_NAME.exec(name);
    if (!match) continue;
    const full = path.join(dir, name);
    const stat = await fsp.stat(full).catch(() => null);
    if (!stat?.isFile()) continue;
    let meta = await readMeta(name);
    if (!meta) {
      const header = await PackageReader.readHeader(full).catch(() => null);
      meta = { kind: match[1] as PackageKind, keyKind: header?.header.kdf.alg === "server-key" ? "SERVER_KEY" : "PASSPHRASE" };
    }
    out.push({ name, bytes: stat.size, createdAt: stat.mtime, meta });
  }
  return out.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

export async function deletePackage(name: string): Promise<boolean> {
  const file = packagePath(name);
  if (!file || !fs.existsSync(file)) return false;
  for (const suffix of ["", ".sha256", ".json"]) await fsp.rm(`${file}${suffix}`, { force: true });
  return true;
}

export async function finishPackageFiles(partial: string, name: string, sha256: string, meta: PackageMeta): Promise<string> {
  const file = packagePath(name);
  if (!file) throw new Error("Bad package name.");
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.rename(partial, file);
  await fsp.writeFile(`${file}.sha256`, `${sha256}  ${name}\n`, { mode: 0o600 });
  await writeMeta(name, { ...meta, sha256 });
  return file;
}

// This app's migrations (to tell an older or newer package apart).
export function appMigrations(): string[] {
  try {
    return fs
      .readdirSync(path.join(process.cwd(), "database", "migrations"))
      .filter((name) => name.endsWith(".sql"))
      .sort();
  } catch {
    return [];
  }
}

let version: string | null = null;
export function appVersion(): string {
  if (version) return version;
  try {
    version = String((JSON.parse(fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8")) as { version?: string }).version ?? "unknown");
  } catch {
    version = process.env.npm_package_version ?? "unknown";
  }
  return version;
}
