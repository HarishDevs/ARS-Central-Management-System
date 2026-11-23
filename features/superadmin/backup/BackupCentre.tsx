"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CloudDownload, CloudUpload, Download, FileCheck2, HardDriveDownload, KeyRound, RotateCcw, ShieldCheck, Trash2, Upload } from "lucide-react";
import { Button, buttonClass } from "@/features/ui/Button";
import { Checkbox, Field, RadioGroup } from "@/features/ui/Field";
import { Badge, Progress } from "@/features/ui/Display";
import { ConfirmButton } from "@/features/ui/ConfirmButton";
import { LiveCheckResult, MoveCentre } from "@/features/superadmin/backup/MoveCentre";
import { formatBytes, KIND_LABEL, PACKAGE_KIND_LABEL, passphraseHint, STATUS_LABEL, type PackageRow, type RunView } from "@/features/superadmin/backup/types";

// D-408 (v1.81.0, BK-1): Super Admin → Backup, restore & migrate. The page
// drives each run in steps (one request about every 20 seconds of work), so
// a big backup or restore never depends on one long request. The passphrase
// stays in this page's memory only and goes with each step; it is never
// saved in the browser or on the server.

type Api<T> = { success: true; data: T } | { success: false; error: { code: string; message: string } };
const BASE = "/api/superadmin/backup-centre";

async function call<T>(url: string, init: RequestInit & { token?: string | null } = {}): Promise<T> {
  const headers: Record<string, string> = { ...(init.body && typeof init.body === "string" ? { "content-type": "application/json" } : {}) };
  if (init.token) headers["x-run-token"] = init.token;
  const response = await fetch(url, { ...init, headers: { ...headers, ...(init.headers as Record<string, string> | undefined) }, cache: "no-store" });
  const body = (await response.json().catch(() => null)) as Api<T> | null;
  if (!body) throw Object.assign(new Error("The server sent back an unexpected answer. Reload the page and check before trying again."), { code: "UNEXPECTED" });
  if (!body.success) throw Object.assign(new Error(body.error.message), { code: body.error.code });
  return body.data;
}

const tokenKey = (id: number) => `ars-backup-run-${id}`;
function saveToken(id: number, token: string | null) {
  try {
    if (token) sessionStorage.setItem(tokenKey(id), token);
  } catch {
    // private mode: the session still works
  }
}
function readToken(id: number): string | null {
  try {
    return sessionStorage.getItem(tokenKey(id));
  } catch {
    return null;
  }
}

function when(iso: string) {
  return new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" });
}

const tone = (status: RunView["status"]) => (status === "DONE" ? "success" : status === "RUNNING" ? "info" : status === "ROLLED_BACK" || status === "CANCELLED" ? "warning" : "danger");

interface Props {
  initial: { packages: PackageRow[]; runs: RunView[] };
  databaseName: string;
  driveReady: boolean;
  serverKeySet: boolean;
  schedule: string;
  s3Ready?: boolean;
}

// v1.82.0 (D-409): what the page keeps in memory besides the passphrase.
const SECRET_LABEL: Partial<Record<RunView["kind"], string>> = { SEND: "Type the pairing code again to carry on", PULL: "Type the pairing code again to carry on", DB_COPY: "Type the target database's password again to carry on" };

interface Active {
  run: RunView;
  token: string | null;
  passphrase: string;
  secret?: string;
  downloadWhenDone?: boolean;
}

export function BackupCentre({ initial, databaseName, driveReady, serverKeySet, schedule, s3Ready = false }: Props) {
  const [data, setData] = useState(initial);
  const [active, setActive] = useState<Active | null>(null);
  const [needPassphrase, setNeedPassphrase] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [verified, setVerified] = useState<RunView | null>(null);
  const [restorePackage, setRestorePackage] = useState<string | null>(null);
  const [finishedRestore, setFinishedRestore] = useState<RunView | null>(null);
  const [secretsFor, setSecretsFor] = useState<string | null>(null);
  const [liveCheck, setLiveCheck] = useState<RunView | null>(null);
  const driving = useRef(false);

  const refresh = useCallback(async () => {
    try {
      setData(await call<{ packages: PackageRow[]; runs: RunView[] }>(`${BASE}/runs`));
    } catch {
      // the next action shows the problem
    }
  }, []);

  // A run left running (a reload, another tab): offer to carry it on.
  const waiting = data.runs.find((item) => item.status === "RUNNING" && item.trigger === "MANUAL" && item.id !== active?.run.id) ?? null;

  const finish = useCallback(
    async (current: Active) => {
      const run = current.run;
      if (run.kind === "VERIFY" && run.status === "DONE") setVerified(run);
      if (run.kind === "RESTORE") setFinishedRestore(run);
      if (run.kind === "LIVE_CHECK" && run.status === "DONE") setLiveCheck(run);
      if (run.kind === "BACKUP" && run.status === "DONE" && current.downloadWhenDone && run.packageName) window.location.assign(`${BASE}/packages/${encodeURIComponent(run.packageName)}`);
      setNotice(run.status === "DONE" ? run.message : null);
      setError(run.status === "DONE" ? null : [run.message, run.error].filter(Boolean).join(" "));
      await refresh();
    },
    [refresh],
  );

  // The driver: one step after another while the run runs.
  useEffect(() => {
    if (!active || active.run.status !== "RUNNING" || needPassphrase || driving.current) return;
    driving.current = true;
    let cancelled = false;
    (async () => {
      let current = active;
      try {
        while (!cancelled && current.run.status === "RUNNING") {
          const { run } = await call<{ run: RunView }>(`${BASE}/runs/${current.run.id}`, { method: "POST", body: JSON.stringify({ ...(current.passphrase ? { passphrase: current.passphrase } : {}), ...(current.secret ? { secret: current.secret } : {}) }), token: current.token });
          current = { ...current, run };
          if (!cancelled) setActive(current);
          if (run.status === "RUNNING" && run.phase === current.run.phase && run.progress.done === current.run.progress.done) await new Promise((resolve) => setTimeout(resolve, 800));
        }
        if (!cancelled) await finish(current);
      } catch (caught) {
        const code = (caught as { code?: string }).code;
        if (code === "PASSPHRASE_NEEDED" || code === "WRONG_PASSPHRASE" || code === "SECRET_NEEDED") setNeedPassphrase(true);
        setError((caught as Error).message);
      } finally {
        driving.current = false;
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.run.id, needPassphrase]);

  async function start(body: Record<string, unknown>, passphrase: string, extra: Partial<Active> = {}) {
    setError(null);
    setNotice(null);
    const result = await call<{ run: RunView; token: string | null }>(`${BASE}/runs`, { method: "POST", body: JSON.stringify(body) });
    saveToken(result.run.id, result.token);
    const next: Active = { run: result.run, token: result.token, passphrase, ...extra };
    setActive(next);
    if (result.run.status !== "RUNNING") await finish(next);
    return result.run;
  }

  async function stop() {
    if (!active) return;
    try {
      const { run } = await call<{ run: RunView }>(`${BASE}/runs/${active.run.id}`, { method: "DELETE" });
      setActive({ ...active, run });
      await finish({ ...active, run });
    } catch (caught) {
      setError((caught as Error).message);
    }
  }

  const busy = Boolean(active && active.run.status === "RUNNING");

  return (
    <div className="space-y-6">
      {/* Live progress of the run this page is driving. */}
      <section aria-labelledby="bk-progress" className={`card px-5 py-4 ${active ? "" : "hidden"}`}>
        <h2 id="bk-progress" className="font-semibold">
          {active ? `${KIND_LABEL[active.run.kind]}${active.run.packageName ? `: ${active.run.packageName}` : ""}` : "Progress"}
        </h2>
        {active && (
          <div className="mt-3 space-y-3">
            <Progress value={active.run.progress.done} max={Math.max(1, active.run.progress.total)} label={`${KIND_LABEL[active.run.kind]} progress`} />
            <p role="status" aria-live="polite" className="text-label text-ink-muted">
              <Badge tone={tone(active.run.status)}>{STATUS_LABEL[active.run.status]}</Badge> {active.run.message}
            </p>
            {needPassphrase && (
              <PassphrasePrompt
                label={SECRET_LABEL[active.run.kind]}
                onSubmit={(value) => {
                  setActive(SECRET_LABEL[active.run.kind] ? { ...active, secret: value } : { ...active, passphrase: value });
                  setNeedPassphrase(false);
                  setError(null);
                }}
              />
            )}
            {busy && (!["RESTORE", "DB_COPY"].includes(active.run.kind) || ["build", "snapshot", "load"].includes(active.run.phase)) && (
              <Button variant="secondary" size="sm" onClick={stop}>
                Stop
              </Button>
            )}
            {busy && <p className="text-caption text-ink-muted">Keep this page open until it finishes. If it closes, open it again and type the passphrase to carry on.</p>}
          </div>
        )}
      </section>

      {error && (
        <p role="alert" className="rounded-md bg-danger-50 px-3 py-2 text-label text-danger-600">
          {error}
        </p>
      )}
      {notice && !error && (
        <p role="status" className="rounded-md bg-success-50 px-3 py-2 text-label text-success-600">
          {notice}
        </p>
      )}

      {waiting && !active && (
        <section className="card px-5 py-4" aria-labelledby="bk-waiting">
          <h2 id="bk-waiting" className="font-semibold">
            A {KIND_LABEL[waiting.kind].toLowerCase()} is still running
          </h2>
          <p className="mt-1 text-label text-ink-muted">{waiting.message}</p>
          <PassphrasePrompt
            label={SECRET_LABEL[waiting.kind] ?? "Type its passphrase to carry on"}
            optional={waiting.keyKind === "SERVER_KEY" || ["DRIVE_COPY", "DRIVE_FETCH", "S3_COPY", "S3_FETCH", "LIVE_CHECK", "URL_FETCH"].includes(waiting.kind)}
            onSubmit={(value) => {
              setNeedPassphrase(false);
              setActive(SECRET_LABEL[waiting.kind] ? { run: waiting, token: readToken(waiting.id), passphrase: "", secret: value } : { run: waiting, token: readToken(waiting.id), passphrase: value });
            }}
          />
        </section>
      )}

      {finishedRestore && finishedRestore.status === "DONE" && finishedRestore.packageName && (
        <AfterRestore run={finishedRestore} onClose={() => setFinishedRestore(null)} onCheck={() => start({ action: "live-check", restoreRunId: finishedRestore.id }, "").then(() => undefined).catch((caught: Error) => setError(caught.message))} busy={busy} />
      )}
      {liveCheck && <LiveCheckResult run={liveCheck} />}
      {secretsFor && !(finishedRestore && finishedRestore.packageName === secretsFor) && (
        <section aria-labelledby="bk-secrets" className="card px-5 py-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="bk-secrets" className="flex items-center gap-2 font-semibold">
              <KeyRound aria-hidden="true" className="h-5 w-5 text-primary-600" /> Server secrets in {secretsFor}
            </h2>
            <Button variant="ghost" size="sm" onClick={() => setSecretsFor(null)}>
              Close
            </Button>
          </div>
          <SecretsPanel name={secretsFor} />
        </section>
      )}

      <MakeBackup disabled={busy} driveReady={driveReady} onStart={(body, passphrase, download) => start(body, passphrase, { downloadWhenDone: download }).then(() => undefined)} onError={setError} />

      <Packages
        packages={data.packages}
        busy={busy}
        driveReady={driveReady}
        onRestore={(name) => {
          setRestorePackage(name);
          setVerified(null);
          setTimeout(() => document.getElementById("bk-restore")?.scrollIntoView({ block: "start" }), 0);
        }}
        onCopyToDrive={(name) => start({ action: "drive-copy", name }, "").then(() => undefined).catch((caught: Error) => setError(caught.message))}
        onDeleted={refresh}
        onSecrets={(name) => {
          setSecretsFor(name);
          window.scrollTo({ top: 0 });
        }}
        onError={setError}
        onUploaded={async (name) => {
          await refresh();
          setNotice(`Uploaded as ${name}. Check it, then restore.`);
          setRestorePackage(name);
        }}
        onFetchFromDrive={(file) => start({ action: "drive-fetch", fileId: file.id, name: file.name, size: file.size }, "").then(() => undefined).catch((caught: Error) => setError(caught.message))}
        s3Ready={s3Ready}
        onCopyToS3={(name) => start({ action: "s3-copy", name }, "").then(() => undefined).catch((caught: Error) => setError(caught.message))}
        onFetchFromS3={(file) => start({ action: "s3-fetch", key: file.key, size: file.size }, "").then(() => undefined).catch((caught: Error) => setError(caught.message))}
      />

      {restorePackage && (
        <Restore
          key={restorePackage}
          name={restorePackage}
          keyKind={data.packages.find((item) => item.name === restorePackage)?.keyKind ?? "PASSPHRASE"}
          serverKeySet={serverKeySet}
          databaseName={databaseName}
          verified={verified && verified.packageName === restorePackage ? verified : null}
          busy={busy}
          onVerify={(passphrase) => start({ action: "verify", name: restorePackage, passphrase }, passphrase).then(() => undefined)}
          onRestore={(body, passphrase) => start({ action: "restore", ...body, passphrase }, passphrase).then(() => undefined)}
          onClose={() => setRestorePackage(null)}
        />
      )}

      <MoveCentre packages={data.packages} busy={busy} onError={setError} onStart={(body, secret) => start(body, "", { secret }).then(() => undefined)} />

      <section aria-labelledby="bk-schedule" className="card px-5 py-4">
        <h2 id="bk-schedule" className="font-semibold">
          Scheduled packages
        </h2>
        <p className="mt-1 text-label text-ink-muted">
          {schedule === "OFF" ? "Off." : `${schedule === "DAILY" ? "Every day" : "Every week"}: a full package (database, attachments, secrets) encrypted with the server's BACKUP_ENCRYPTION_KEY, made by the job runner.`}{" "}
          {!serverKeySet && "BACKUP_ENCRYPTION_KEY isn't set on this server, so scheduled packages can't be made yet."} Change it in{" "}
          <a className="link" href="#settings-BACKUP">
            the settings below
          </a>
          . The daily database backup (Overview → Backups) carries on as before.
        </p>
      </section>

      <section aria-labelledby="bk-recent" className="card px-5 py-4">
        <h2 id="bk-recent" className="font-semibold">
          Recent activity
        </h2>
        {data.runs.length === 0 ? (
          <p className="mt-2 text-label text-ink-muted">Nothing yet.</p>
        ) : (
          <div className="mt-3 overflow-x-auto" tabIndex={0} role="group" aria-label="Recent activity table">
            <table className="data-table">
              <caption className="sr-only">Recent backups, checks and restores</caption>
              <thead>
                <tr>
                  <th scope="col">When</th>
                  <th scope="col">What</th>
                  <th scope="col">Package</th>
                  <th scope="col">Status</th>
                  <th scope="col">Details</th>
                </tr>
              </thead>
              <tbody>
                {data.runs.map((item) => (
                  <tr key={item.id}>
                    <td className="whitespace-nowrap">{when(item.createdAt)}</td>
                    <td>
                      {KIND_LABEL[item.kind]}
                      {item.trigger === "SCHEDULED" ? " (scheduled)" : ""}
                    </td>
                    <td className="break-all">{item.packageName ?? "—"}</td>
                    <td>
                      <Badge tone={tone(item.status)}>{STATUS_LABEL[item.status]}</Badge>
                    </td>
                    <td className="max-w-md text-caption text-ink-muted">{[item.message, item.error].filter(Boolean).join(" ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function PassphrasePrompt({ onSubmit, label = "Type the passphrase again to carry on", optional = false }: { onSubmit: (value: string) => void; label?: string; optional?: boolean }) {
  const [value, setValue] = useState("");
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (value || optional) onSubmit(value);
      }}
    >
      <Field label={label} hint={optional ? "Leave it empty: this server holds the key." : "It is never stored, so it is asked for again after a reload."} className="min-w-[16rem] flex-1">
        {(control) => <input {...control} type="password" autoComplete="off" className="field-input" value={value} onChange={(event) => setValue(event.target.value)} />}
      </Field>
      <Button type="submit" size="sm">
        Carry on
      </Button>
    </form>
  );
}

function PassphraseFields({ value, confirm, onValue, onConfirm }: { value: string; confirm: string; onValue: (value: string) => void; onConfirm: (value: string) => void }) {
  const hint = passphraseHint(value);
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Passphrase" hint={<span className={hint.ok ? "text-success-600" : undefined}>{hint.text}</span>}>
        {(control) => <input {...control} type="password" autoComplete="new-password" className="field-input" value={value} onChange={(event) => onValue(event.target.value)} />}
      </Field>
      <Field label="Type it again" error={confirm && confirm !== value ? "The two don't match." : undefined}>
        {(control) => <input {...control} type="password" autoComplete="new-password" className="field-input" value={confirm} onChange={(event) => onConfirm(event.target.value)} />}
      </Field>
    </div>
  );
}

function MakeBackup({ disabled, driveReady, onStart, onError }: { disabled: boolean; driveReady: boolean; onStart: (body: Record<string, unknown>, passphrase: string, download: boolean) => Promise<void>; onError: (message: string) => void }) {
  const [include, setInclude] = useState<"full" | "database">("full");
  const [keep, setKeep] = useState(true);
  const [download, setDownload] = useState(true);
  const [drive, setDrive] = useState(false);
  const [passphrase, setPassphrase] = useState("");
  const [confirm, setConfirm] = useState("");
  const [pending, setPending] = useState(false);
  const ready = passphraseHint(passphrase).ok && confirm === passphrase && (keep || download || drive);
  return (
    <section aria-labelledby="bk-make" className="card px-5 py-4">
      <h2 id="bk-make" className="flex items-center gap-2 font-semibold">
        <ShieldCheck aria-hidden="true" className="h-5 w-5 text-primary-600" /> Make a backup
      </h2>
      <p className="mt-1 text-label text-ink-muted">
        One encrypted file (.arsbak) with the whole system. Without the passphrase nobody can open it, not even us: keep the passphrase somewhere safe, apart from the file.
      </p>
      <form
        className="mt-4 space-y-4"
        onSubmit={async (event) => {
          event.preventDefault();
          if (!ready) return;
          setPending(true);
          try {
            await onStart({ action: "backup", include, keepOnServer: keep, copyToDrive: drive, passphrase }, passphrase, download);
            setPassphrase("");
            setConfirm("");
          } catch (caught) {
            onError((caught as Error).message);
          } finally {
            setPending(false);
          }
        }}
      >
        <RadioGroup
          legend="What goes in"
          name="bk-include"
          value={include}
          onChange={setInclude}
          options={[
            { value: "full", label: "Everything", hint: "Database, every attachment and the server secrets (keys, passwords) to rebuild this server anywhere." },
            { value: "database", label: "Database only", hint: "Every table and row; no attachments, no secrets. Smaller and quicker." },
          ]}
        />
        <fieldset className="space-y-2">
          <legend className="field-label">Where it goes</legend>
          <Checkbox label="Keep it on the server" hint="In Private Storage, listed below. Untick to remove it after the download (or after 24 hours)." checked={keep} onChange={(event) => setKeep(event.target.checked)} />
          <Checkbox label="Download it to this computer when it's ready" checked={download} onChange={(event) => setDownload(event.target.checked)} />
          <Checkbox label="Copy it to Google Drive" hint={driveReady ? "The folder set in Providers & security → Google Drive backup." : "Set up Google Drive backup in Providers & security first."} disabled={!driveReady} checked={drive} onChange={(event) => setDrive(event.target.checked)} />
        </fieldset>
        <PassphraseFields value={passphrase} confirm={confirm} onValue={setPassphrase} onConfirm={setConfirm} />
        <Button type="submit" loading={pending} loadingLabel="Starting…" disabled={disabled || !ready} icon={<ShieldCheck aria-hidden="true" className="h-4 w-4" />}>
          Make the backup
        </Button>
      </form>
    </section>
  );
}

function Packages({
  packages,
  busy,
  driveReady,
  onRestore,
  onCopyToDrive,
  onDeleted,
  onError,
  onUploaded,
  onFetchFromDrive,
  onSecrets,
  s3Ready,
  onCopyToS3,
  onFetchFromS3,
}: {
  onSecrets: (name: string) => void;
  s3Ready: boolean;
  onCopyToS3: (name: string) => void;
  onFetchFromS3: (file: { key: string; size: number }) => void;
  packages: PackageRow[];
  busy: boolean;
  driveReady: boolean;
  onRestore: (name: string) => void;
  onCopyToDrive: (name: string) => void;
  onDeleted: () => Promise<void>;
  onError: (message: string) => void;
  onUploaded: (name: string) => Promise<void>;
  onFetchFromDrive: (file: { id: string; name: string; size: number }) => void;
}) {
  const [upload, setUpload] = useState<{ name: string; sent: number; size: number } | null>(null);
  const [driveFiles, setDriveFiles] = useState<{ id: string; name: string; size: number; createdTime: string }[] | null>(null);
  const [driveLoading, setDriveLoading] = useState(false);
  const [s3Files, setS3Files] = useState<{ key: string; size: number; modified: string }[] | null>(null);
  const [s3Loading, setS3Loading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  async function send(file: File) {
    try {
      const { id, pieceSize } = await call<{ id: number; pieceSize: number }>(`${BASE}/uploads`, { method: "POST", body: JSON.stringify({ fileName: file.name, size: file.size }) });
      let offset = 0;
      let packageName: string | null = null;
      setUpload({ name: file.name, sent: 0, size: file.size });
      while (offset < file.size) {
        const piece = file.slice(offset, Math.min(file.size, offset + pieceSize));
        let result: { received: number; size: number; packageName: string | null } | null = null;
        for (let attempt = 0; attempt < 4 && !result; attempt += 1) {
          try {
            result = await call(`${BASE}/uploads/${id}?offset=${offset}`, { method: "PUT", body: piece, headers: { "content-type": "application/octet-stream" } });
          } catch (caught) {
            const code = (caught as { code?: string }).code;
            if (code !== "UNEXPECTED" && code !== "SYSTEM_ERROR") throw caught;
            await new Promise((resolve) => setTimeout(resolve, 1500 * (attempt + 1))); // a dropped connection: try the piece again
          }
        }
        if (!result) throw new Error("The upload kept failing. Check the connection and try again.");
        offset = result.received;
        packageName = result.packageName;
        setUpload({ name: file.name, sent: offset, size: file.size });
      }
      setUpload(null);
      if (packageName) await onUploaded(packageName);
    } catch (caught) {
      setUpload(null);
      onError((caught as Error).message);
    }
  }

  return (
    <section aria-labelledby="bk-packages" className="card px-5 py-4">
      <h2 id="bk-packages" className="font-semibold">
        Packages on this server
      </h2>
      <p className="mt-1 text-label text-ink-muted">Every package here can be checked and restored. To restore one made elsewhere, upload it or copy it from Google Drive first.</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <input
          ref={fileInput}
          type="file"
          accept=".arsbak"
          className="sr-only"
          aria-label="Choose a backup package to upload"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) void send(file);
          }}
        />
        <Button variant="secondary" size="sm" disabled={busy || Boolean(upload)} onClick={() => fileInput.current?.click()} icon={<Upload aria-hidden="true" className="h-4 w-4" />}>
          Upload a package
        </Button>
        {driveReady && (
          <Button
            variant="secondary"
            size="sm"
            loading={driveLoading}
            loadingLabel="Reading Drive…"
            disabled={busy}
            icon={<CloudDownload aria-hidden="true" className="h-4 w-4" />}
            onClick={async () => {
              setDriveLoading(true);
              try {
                setDriveFiles((await call<{ files: { id: string; name: string; size: number; createdTime: string }[] }>(`${BASE}/drive`)).files);
              } catch (caught) {
                onError((caught as Error).message);
              } finally {
                setDriveLoading(false);
              }
            }}
          >
            From Google Drive
          </Button>
        )}
        {s3Ready && (
          <Button
            variant="secondary"
            size="sm"
            loading={s3Loading}
            loadingLabel="Reading the bucket…"
            disabled={busy}
            icon={<CloudDownload aria-hidden="true" className="h-4 w-4" />}
            onClick={async () => {
              setS3Loading(true);
              try {
                setS3Files((await call<{ files: { key: string; size: number; modified: string }[] }>(`${BASE}/s3`)).files);
              } catch (caught) {
                onError((caught as Error).message);
              } finally {
                setS3Loading(false);
              }
            }}
          >
            From S3 storage
          </Button>
        )}
      </div>
      {s3Files && (
        <div className="mt-3 rounded-md border border-line px-3 py-2">
          <h3 className="text-label font-semibold">Packages in the S3 bucket</h3>
          {s3Files.length === 0 ? (
            <p className="text-caption text-ink-muted">None yet.</p>
          ) : (
            <ul className="mt-1 divide-y divide-line">
              {s3Files.map((file) => (
                <li key={file.key} className="flex flex-wrap items-center justify-between gap-2 py-1.5 text-label">
                  <span className="break-all">
                    {file.key} <span className="text-ink-muted">({formatBytes(file.size)})</span>
                  </span>
                  <Button variant="secondary" size="sm" disabled={busy} onClick={() => onFetchFromS3(file)}>
                    Copy here
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {upload && (
        <div className="mt-3 space-y-1">
          <Progress value={upload.sent} max={upload.size} label={`Uploading ${upload.name}`} />
          <p role="status" aria-live="polite" className="text-caption text-ink-muted">
            Uploading {upload.name}: {formatBytes(upload.sent)} of {formatBytes(upload.size)}. Keep this page open.
          </p>
        </div>
      )}
      {driveFiles && (
        <div className="mt-3 rounded-md border border-line px-3 py-2">
          <h3 className="text-label font-semibold">Packages in the Google Drive folder</h3>
          {driveFiles.length === 0 ? (
            <p className="text-caption text-ink-muted">None yet.</p>
          ) : (
            <ul className="mt-1 divide-y divide-line">
              {driveFiles.map((file) => (
                <li key={file.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5 text-label">
                  <span className="break-all">
                    {file.name} <span className="text-ink-muted">({formatBytes(file.size)})</span>
                  </span>
                  <Button variant="secondary" size="sm" disabled={busy} onClick={() => onFetchFromDrive(file)}>
                    Copy here
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {packages.length === 0 ? (
        <p className="mt-3 text-label text-ink-muted">No packages yet.</p>
      ) : (
        <div className="mt-3 overflow-x-auto" tabIndex={0} role="group" aria-label="Packages table">
          <table className="data-table">
            <caption className="sr-only">Backup packages on this server</caption>
            <thead>
              <tr>
                <th scope="col">Package</th>
                <th scope="col">Kind</th>
                <th scope="col">Size</th>
                <th scope="col">Made</th>
                <th scope="col">Opens with</th>
                <th scope="col">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {packages.map((item) => (
                <tr key={item.name}>
                  <td className="break-all">
                    {item.name}
                    {item.source && <span className="block text-caption text-ink-muted">{item.source}</span>}
                  </td>
                  <td>
                    {PACKAGE_KIND_LABEL[item.kind] ?? item.kind}
                    {item.checked && (
                      <Badge tone="success" className="ml-1">
                        Checked
                      </Badge>
                    )}
                  </td>
                  <td className="whitespace-nowrap">{formatBytes(item.bytes)}</td>
                  <td className="whitespace-nowrap">{when(item.createdAt)}</td>
                  <td>{item.keyKind === "SERVER_KEY" ? "Server key" : "Passphrase"}</td>
                  <td>
                    <div className="flex flex-wrap justify-end gap-1.5">
                      <a className={buttonClass("secondary", "sm")} href={`${BASE}/packages/${encodeURIComponent(item.name)}`} aria-label={`Download ${item.name}`}>
                        <Download aria-hidden="true" className="h-4 w-4" /> Download
                      </a>
                      <Button variant="secondary" size="sm" disabled={busy} onClick={() => onRestore(item.name)} aria-label={`Check and restore ${item.name}`} icon={<RotateCcw aria-hidden="true" className="h-4 w-4" />}>
                        Restore…
                      </Button>
                      {["full", "scheduled", "safety", "upload", "drive", "received"].includes(item.kind) && (
                        <Button variant="ghost" size="sm" onClick={() => onSecrets(item.name)} aria-label={`Server secrets in ${item.name}`} icon={<KeyRound aria-hidden="true" className="h-4 w-4" />}>
                          Secrets
                        </Button>
                      )}
                      {s3Ready && (
                        <Button variant="ghost" size="sm" disabled={busy} onClick={() => onCopyToS3(item.name)} aria-label={`Copy ${item.name} to S3 storage`} icon={<CloudUpload aria-hidden="true" className="h-4 w-4" />}>
                          To S3
                        </Button>
                      )}
                      {driveReady && (
                        <Button variant="ghost" size="sm" disabled={busy} onClick={() => onCopyToDrive(item.name)} aria-label={`Copy ${item.name} to Google Drive`} icon={<CloudUpload aria-hidden="true" className="h-4 w-4" />}>
                          To Drive
                        </Button>
                      )}
                      <ConfirmButton
                        className={buttonClass("danger-quiet", "sm")}
                        ariaLabel={`Delete ${item.name}`}
                        title="Delete this package?"
                        body={`${item.name} is removed from the server for good. Copies you downloaded or put on Drive stay.`}
                        onConfirm={async () => {
                          try {
                            await call(`${BASE}/packages/${encodeURIComponent(item.name)}`, { method: "DELETE" });
                            await onDeleted();
                          } catch (caught) {
                            onError((caught as Error).message);
                          }
                        }}
                      >
                        <Trash2 aria-hidden="true" className="h-4 w-4" /> Delete
                      </ConfirmButton>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

type Summary = {
  appVersion: string | null;
  createdAt: string | null;
  kind: string | null;
  includes: { database: boolean; files: boolean; secrets: boolean } | null;
  tables: { name: string; rows: number }[];
  rows: number;
  files: number;
  fileBytes: number;
  hasSecrets: boolean;
  bytes: number;
  warnings: string[];
  source: { url?: string | null; database?: string | null } | null;
};

function Restore({
  name,
  keyKind,
  serverKeySet,
  databaseName,
  verified,
  busy,
  onVerify,
  onRestore,
  onClose,
}: {
  name: string;
  keyKind: "PASSPHRASE" | "SERVER_KEY";
  serverKeySet: boolean;
  databaseName: string;
  verified: RunView | null;
  busy: boolean;
  onVerify: (passphrase: string) => Promise<void>;
  onRestore: (body: Record<string, unknown>, passphrase: string) => Promise<void>;
  onClose: () => void;
}) {
  const [passphrase, setPassphrase] = useState("");
  const [mode, setMode] = useState<"full" | "database" | "files" | "tables">("full");
  const [tables, setTables] = useState<string[]>([]);
  const [filter, setFilter] = useState("");
  const [confirm, setConfirm] = useState("");
  const [accept, setAccept] = useState(false);
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const summary = (verified?.summary ?? null) as Summary | null;
  const serverOpens = keyKind === "SERVER_KEY" && serverKeySet;
  const includes = summary?.includes ?? { database: true, files: false, secrets: false };
  const modes = [
    ...(includes.database && includes.files ? [{ value: "full" as const, label: "Everything", hint: "Database, attachments and secrets: the system as it was." }] : []),
    ...(includes.database ? [{ value: "database" as const, label: "Database only", hint: "Every table; attachments stay as they are." }] : []),
    ...(includes.files ? [{ value: "files" as const, label: "Attachments only", hint: "Files are added or replaced; the database stays." }] : []),
    ...(includes.database ? [{ value: "tables" as const, label: "Chosen tables", hint: "Only the tables you tick." }] : []),
  ];
  useEffect(() => {
    if (summary && !modes.some((option) => option.value === mode)) setMode(modes[0]?.value ?? "database");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [summary]);

  return (
    <section id="bk-restore" aria-labelledby="bk-restore-title" className="card scroll-mt-20 px-5 py-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="bk-restore-title" className="flex items-center gap-2 font-semibold">
          <RotateCcw aria-hidden="true" className="h-5 w-5 text-primary-600" /> Restore {name}
        </h2>
        <Button variant="ghost" size="sm" onClick={onClose}>
          Close
        </Button>
      </div>
      <ol className="mt-2 list-decimal space-y-1 pl-5 text-label text-ink-muted">
        <li>Check the package: every part is read and its checksum compared. Nothing is changed.</li>
        <li>Choose what to restore and type the database&apos;s name.</li>
        <li>A safety snapshot of the system as it is now is made first. The backup is loaded beside the live data and switched in at once; if anything fails, the live data is switched back (or the snapshot is put back).</li>
      </ol>

      {!summary && (
        <form
          className="mt-4 flex flex-wrap items-end gap-2"
          onSubmit={async (event) => {
            event.preventDefault();
            setProblem(null);
            setPending(true);
            try {
              await onVerify(passphrase);
            } catch (caught) {
              setProblem((caught as Error).message);
            } finally {
              setPending(false);
            }
          }}
        >
          <Field label="Passphrase of the package" hint={serverOpens ? "Made with this server's key: leave it empty." : keyKind === "SERVER_KEY" ? "Made by a server with its BACKUP_ENCRYPTION_KEY: type that key." : "The passphrase typed when it was made."} className="min-w-[16rem] flex-1" error={problem ?? undefined}>
            {(control) => <input {...control} type="password" autoComplete="off" className="field-input" value={passphrase} onChange={(event) => setPassphrase(event.target.value)} />}
          </Field>
          <Button type="submit" loading={pending} loadingLabel="Checking…" disabled={busy || (!passphrase && !serverOpens)} icon={<FileCheck2 aria-hidden="true" className="h-4 w-4" />}>
            Check package
          </Button>
        </form>
      )}

      {summary && verified && (
        <div className="mt-4 space-y-4">
          <dl className="grid gap-x-6 gap-y-1 text-label sm:grid-cols-2">
            <div>
              <dt className="inline text-ink-muted">Made: </dt>
              <dd className="inline">{summary.createdAt ? when(summary.createdAt) : "unknown"}</dd>
            </div>
            <div>
              <dt className="inline text-ink-muted">By ARS CMS version: </dt>
              <dd className="inline">{summary.appVersion ?? "unknown"}</dd>
            </div>
            <div>
              <dt className="inline text-ink-muted">From: </dt>
              <dd className="inline break-all">{[summary.source?.url, summary.source?.database].filter(Boolean).join(", ") || "unknown"}</dd>
            </div>
            <div>
              <dt className="inline text-ink-muted">Holds: </dt>
              <dd className="inline">
                {summary.tables.length} tables, {summary.rows.toLocaleString("en-IN")} rows, {summary.files.toLocaleString("en-IN")} attachments ({formatBytes(summary.fileBytes)}){summary.hasSecrets ? ", server secrets" : ""}
              </dd>
            </div>
          </dl>
          {summary.warnings.length > 0 && (
            <div role="alert" className="space-y-1 rounded-md bg-warning-50 px-3 py-2 text-label text-warning-600">
              {summary.warnings.map((warning) => (
                <p key={warning}>{warning}</p>
              ))}
            </div>
          )}
          <form
            className="space-y-4"
            onSubmit={async (event) => {
              event.preventDefault();
              setProblem(null);
              setPending(true);
              try {
                await onRestore({ verifyRunId: verified.id, mode, tables, confirm, acceptWarnings: accept }, passphrase);
              } catch (caught) {
                setProblem((caught as Error).message);
              } finally {
                setPending(false);
              }
            }}
          >
            <RadioGroup legend="What to restore" name="bk-mode" value={mode} onChange={setMode} options={modes} />
            {mode === "tables" && (
              <fieldset className="space-y-2">
                <legend className="field-label">Tables ({tables.length} ticked)</legend>
                <input type="search" className="field-input max-w-xs" placeholder="Filter tables" aria-label="Filter tables" value={filter} onChange={(event) => setFilter(event.target.value)} />
                <div className="grid max-h-64 gap-1 overflow-y-auto rounded-md border border-line p-2 sm:grid-cols-2 lg:grid-cols-3">
                  {summary.tables
                    .filter((table) => table.name.includes(filter.trim().toLowerCase()))
                    .map((table) => (
                      <Checkbox
                        key={table.name}
                        label={`${table.name} (${table.rows.toLocaleString("en-IN")})`}
                        checked={tables.includes(table.name)}
                        onChange={(event) => setTables((current) => (event.target.checked ? [...current, table.name] : current.filter((value) => value !== table.name)))}
                      />
                    ))}
                </div>
              </fieldset>
            )}
            {summary.warnings.length > 0 && <Checkbox label="I've read the warnings above" checked={accept} onChange={(event) => setAccept(event.target.checked)} />}
            <Field label={`Type the database's name to confirm: ${databaseName}`} hint="What is restored replaces what is here now (after the safety snapshot)." error={problem ?? undefined}>
              {(control) => <input {...control} autoComplete="off" spellCheck={false} className="field-input max-w-sm" value={confirm} onChange={(event) => setConfirm(event.target.value)} />}
            </Field>
            <Button type="submit" variant="danger" loading={pending} loadingLabel="Starting…" disabled={busy || confirm.trim() !== databaseName || (summary.warnings.length > 0 && !accept) || (mode === "tables" && tables.length === 0)} icon={<HardDriveDownload aria-hidden="true" className="h-4 w-4" />}>
              Restore now
            </Button>
          </form>
        </div>
      )}
    </section>
  );
}

function AfterRestore({ run, onClose, onCheck, busy }: { run: RunView; onClose: () => void; onCheck: () => void; busy: boolean }) {
  const hasSecrets = Boolean((run.summary as { hasSecrets?: boolean } | null)?.hasSecrets) && run.mode === "full";
  return (
    <section aria-labelledby="bk-after" className="card px-5 py-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="bk-after" className="flex items-center gap-2 font-semibold">
          <KeyRound aria-hidden="true" className="h-5 w-5 text-primary-600" /> After the restore
        </h2>
        <Button variant="ghost" size="sm" onClick={onClose}>
          Close
        </Button>
      </div>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-label text-ink-muted">
        <li>Everyone signs in again (you too: if this page stops answering, sign in and open it again; the package&apos;s Secrets button is in the list).</li>
        <li>Encrypted settings were re-keyed to this server&apos;s ENCRYPTION_KEY, so keep this server&apos;s ENCRYPTION_KEY.</li>
        {hasSecrets && <li>If this server is a new home for the system (a move), set the other secrets from the package below, then publish (GoDaddy) or restart (VPS).</li>}
      </ul>
      <div className="mt-3">
        <Button variant="secondary" size="sm" disabled={busy} onClick={onCheck}>
          Check the system now
        </Button>
        <span className="ml-2 text-caption text-ink-muted">Row counts against the package, every attachment&apos;s checksum, and whether sign-in will work.</span>
      </div>
      {hasSecrets && run.packageName && <SecretsPanel name={run.packageName} />}
    </section>
  );
}

function SecretsPanel({ name }: { name: string }) {
  const [passphrase, setPassphrase] = useState("");
  const [secrets, setSecrets] = useState<{ env: Record<string, string>; here: Record<string, string>; envFile?: string } | null>(null);
  const [shown, setShown] = useState(false);
  const [copied, setCopied] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const envText = secrets
    ? Object.entries(secrets.env)
        .map(([envName, value]) => `${envName}=${/[\s#"']/.test(value) ? JSON.stringify(value) : value}`)
        .join("\n")
    : "";
  if (!secrets) {
    return (
      <form
        className="mt-3 flex flex-wrap items-end gap-2"
        onSubmit={async (event) => {
          event.preventDefault();
          setPending(true);
          setProblem(null);
          try {
            setSecrets(await call(`${BASE}/packages/${encodeURIComponent(name)}/secrets`, { method: "POST", body: JSON.stringify({ passphrase }) }));
          } catch (caught) {
            setProblem((caught as Error).message);
          } finally {
            setPending(false);
          }
        }}
      >
        <Field label="Passphrase of the package" hint="Showing the secrets is recorded and every Super Admin is told." className="min-w-[16rem] flex-1" error={problem ?? undefined}>
          {(control) => <input {...control} type="password" autoComplete="off" className="field-input" value={passphrase} onChange={(event) => setPassphrase(event.target.value)} />}
        </Field>
        <Button type="submit" variant="secondary" loading={pending} loadingLabel="Opening…">
          Show the server secrets
        </Button>
      </form>
    );
  }
  return (
    <div className="mt-3 space-y-3">
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" size="sm" onClick={() => setShown((value) => !value)} aria-pressed={shown}>
          {shown ? "Hide values" : "Show values"}
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            void navigator.clipboard?.writeText(envText).then(() => setCopied(true));
          }}
        >
          {copied ? "Copied" : "Copy as .env"}
        </Button>
        {secrets.envFile && (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              // A ready .env for a VPS: this server's database, keys and folders, the package's other values. Made in the browser; never stored on the server.
              const link = document.createElement("a");
              link.href = URL.createObjectURL(new Blob([secrets.envFile!], { type: "text/plain" }));
              link.download = ".env";
              link.click();
              setTimeout(() => URL.revokeObjectURL(link.href), 1000);
            }}
          >
            Download .env for a VPS
          </Button>
        )}
      </div>
      <div className="overflow-x-auto" tabIndex={0} role="group" aria-label="Server secrets table">
        <table className="data-table">
          <caption className="sr-only">Server secrets in the package</caption>
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Value</th>
              <th scope="col">On this server</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(secrets.env).map(([envName, value]) => (
              <tr key={envName}>
                <td className="font-mono text-caption">{envName}</td>
                <td className="max-w-md break-all font-mono text-caption">{shown ? value : "••••••••"}</td>
                <td>
                  <Badge tone={secrets.here[envName] === "same" ? "success" : secrets.here[envName] === "missing" ? "warning" : "neutral"}>{secrets.here[envName] === "same" ? "Same" : secrets.here[envName] === "missing" ? "Not set" : "Different"}</Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-caption text-ink-muted">
        GoDaddy: the app → Secrets, add or change each, then Publish. VPS: put them in the app&apos;s .env file (Copy as .env) and restart. Keep this server&apos;s ENCRYPTION_KEY and DB_* values: the data was re-keyed for this server and the database settings are this server&apos;s own.
      </p>
    </div>
  );
}
