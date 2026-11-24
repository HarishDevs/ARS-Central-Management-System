"use client";

import { formatTime } from "@/lib/format/date";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeftRight, Database, Link2, Send } from "lucide-react";
import { Button } from "@/features/ui/Button";
import { Badge } from "@/features/ui/Display";
import { Field, Select } from "@/features/ui/Field";
import type { PackageRow, RunView } from "@/features/superadmin/backup/types";

// D-409 (v1.82.0, BK-1 part 2): moving the system to another server and back.
// App to app with one-time pairing codes (send, or offer and pull), from a
// link, and database to database. Codes and the target password stay in this
// page's memory only and go with each step.

type Api<T> = { success: true; data: T } | { success: false; error: { code: string; message: string } };
const BASE = "/api/superadmin/backup-centre";

async function call<T>(url: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(url, { ...init, headers: init.body ? { "content-type": "application/json" } : undefined, cache: "no-store" });
  const body = (await response.json().catch(() => null)) as Api<T> | null;
  if (!body) throw new Error("The server sent back an unexpected answer. Reload the page and check before trying again.");
  if (!body.success) throw Object.assign(new Error(body.error.message), { code: body.error.code });
  return body.data;
}

interface Pairing {
  id: number;
  purpose: "RECEIVE" | "OFFER";
  packageName: string | null;
  status: string;
  expiresAt: string;
  bytesSent: number;
  peerIp: string | null;
}

type Tab = "receive" | "send" | "pull" | "link" | "database";
const TABS: { id: Tab; label: string }[] = [
  { id: "receive", label: "Receive here" },
  { id: "send", label: "Send there" },
  { id: "pull", label: "Pull from there" },
  { id: "link", label: "From a link" },
  { id: "database", label: "Database to database" },
];

export function MoveCentre({ packages, busy, onStart, onError }: { packages: PackageRow[]; busy: boolean; onStart: (body: Record<string, unknown>, secret: string) => Promise<RunView | void>; onError: (message: string) => void }) {
  const [tab, setTab] = useState<Tab>("receive");
  return (
    <section aria-labelledby="bk-move" className="card px-5 py-4">
      <h2 id="bk-move" className="flex items-center gap-2 font-semibold">
        <ArrowLeftRight aria-hidden="true" className="h-5 w-5 text-primary-600" /> Move to another server (GoDaddy ↔ VPS)
      </h2>
      <p className="mt-1 text-label text-ink-muted">
        Both servers run ARS CMS v1.82.0 or later with this centre switched on. The package stays encrypted with its passphrase all the way; restore it on the other server as usual (Check package, then Restore). Never use GoDaddy&apos;s Database Manager → Import for this.
      </p>
      <div role="tablist" aria-label="Ways to move" className="mt-3 flex flex-wrap gap-1.5">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            id={`bk-move-tab-${item.id}`}
            aria-selected={tab === item.id}
            aria-controls={`bk-move-panel-${item.id}`}
            tabIndex={tab === item.id ? 0 : -1}
            className={`rounded-md border px-3 py-1.5 text-label ${tab === item.id ? "border-primary-600 bg-primary-50 font-medium text-ink" : "border-line text-ink-muted"}`}
            onClick={() => setTab(item.id)}
            onKeyDown={(event) => {
              const index = TABS.findIndex((entry) => entry.id === tab);
              const next = event.key === "ArrowRight" ? (index + 1) % TABS.length : event.key === "ArrowLeft" ? (index + TABS.length - 1) % TABS.length : null;
              if (next === null) return;
              event.preventDefault();
              setTab(TABS[next]!.id);
              document.getElementById(`bk-move-tab-${TABS[next]!.id}`)?.focus();
            }}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`bk-move-panel-${tab}`} aria-labelledby={`bk-move-tab-${tab}`} className="mt-4">
        {tab === "receive" && <Pairings purpose="RECEIVE" packages={packages} onError={onError} />}
        {tab === "send" && <SendForm packages={packages} busy={busy} onStart={onStart} onError={onError} />}
        {tab === "pull" && (
          <div className="space-y-6">
            <PullForm busy={busy} onStart={onStart} onError={onError} />
            <Pairings purpose="OFFER" packages={packages} onError={onError} />
          </div>
        )}
        {tab === "link" && <LinkForm busy={busy} onStart={onStart} onError={onError} />}
        {tab === "database" && <DatabaseForm busy={busy} onStart={onStart} onError={onError} />}
      </div>
    </section>
  );
}

function Pairings({ purpose, packages, onError }: { purpose: "RECEIVE" | "OFFER"; packages: PackageRow[]; onError: (message: string) => void }) {
  const [list, setList] = useState<Pairing[]>([]);
  const [fresh, setFresh] = useState<{ code: string; expiresAt: string } | null>(null);
  const [name, setName] = useState(packages[0]?.name ?? "");
  const [pending, setPending] = useState(false);
  const load = useCallback(async () => {
    try {
      setList((await call<{ pairings: Pairing[] }>(`${BASE}/pairings`)).pairings.filter((item) => item.purpose === purpose));
    } catch (caught) {
      onError((caught as Error).message);
    }
  }, [purpose, onError]);
  useEffect(() => {
    void load();
  }, [load]);
  return (
    <div className="space-y-3">
      <p className="text-label text-ink-muted">
        {purpose === "RECEIVE"
          ? "1. Make a pairing code here. 2. On the other server: Move to another server → Send there, with this server's address and the code. The package arrives in Packages on this server as Received. The code works once and must be used within 2 hours."
          : "Or offer a package from this server: make a code for it here, then on the other server use Pull from there with this server's address and the code."}
      </p>
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={async (event) => {
          event.preventDefault();
          setPending(true);
          try {
            setFresh(await call(`${BASE}/pairings`, { method: "POST", body: JSON.stringify({ action: "create", purpose, ...(purpose === "OFFER" ? { name } : {}) }) }));
            await load();
          } catch (caught) {
            onError((caught as Error).message);
          } finally {
            setPending(false);
          }
        }}
      >
        {purpose === "OFFER" && (
          <Field label="Package to offer" className="min-w-[16rem] flex-1">
            {(control) => (
              <Select {...control} value={name} onChange={(event) => setName(event.target.value)}>
                {packages.map((item) => (
                  <option key={item.name} value={item.name}>
                    {item.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )}
        <Button type="submit" variant="secondary" loading={pending} loadingLabel="Making…" disabled={purpose === "OFFER" && !name}>
          {purpose === "RECEIVE" ? "Make a pairing code" : "Make a code for this package"}
        </Button>
      </form>
      {fresh && (
        <p role="status" className="rounded-md bg-primary-50 px-3 py-2 text-label">
          Pairing code (shown once): <strong className="font-mono">{fresh.code}</strong> · valid until {formatTime(fresh.expiresAt)}. Type it on the other server.
        </p>
      )}
      {list.length > 0 && (
        <ul className="divide-y divide-line rounded-md border border-line text-label">
          {list.map((item) => (
            <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
              <span>
                <Badge tone={item.status === "OPEN" ? "info" : "warning"}>{item.status === "OPEN" ? "Waiting" : "In use"}</Badge> {item.packageName ?? "Any package"}
                {item.peerIp ? ` · from ${item.peerIp}` : ""}
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={async () => {
                  try {
                    await call(`${BASE}/pairings`, { method: "POST", body: JSON.stringify({ action: "revoke", id: item.id }) });
                    await load();
                  } catch (caught) {
                    onError((caught as Error).message);
                  }
                }}
              >
                Withdraw
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

type StartProps = { busy: boolean; onStart: (body: Record<string, unknown>, secret: string) => Promise<RunView | void>; onError: (message: string) => void };

function useSubmit(onError: (message: string) => void) {
  const [pending, setPending] = useState(false);
  const submit = async (run: () => Promise<unknown>) => {
    setPending(true);
    try {
      await run();
    } catch (caught) {
      onError((caught as Error).message);
    } finally {
      setPending(false);
    }
  };
  return { pending, submit };
}

function SendForm({ packages, busy, onStart, onError }: StartProps & { packages: PackageRow[] }) {
  const [name, setName] = useState(packages[0]?.name ?? "");
  const [url, setUrl] = useState("");
  const [code, setCode] = useState("");
  const { pending, submit } = useSubmit(onError);
  return (
    <form
      className="grid gap-3 sm:grid-cols-2"
      onSubmit={(event) => {
        event.preventDefault();
        void submit(() => onStart({ action: "send", name, url, code }, code));
      }}
    >
      <Field label="Package to send" hint="Make one first with Make a backup → Everything.">
        {(control) => (
          <Select {...control} value={name} onChange={(event) => setName(event.target.value)}>
            {packages.map((item) => (
              <option key={item.name} value={item.name}>
                {item.name}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Field label="The other server's address" hint="e.g. https://cms.example.com">
        {(control) => <input {...control} type="url" inputMode="url" autoComplete="off" className="field-input" value={url} onChange={(event) => setUrl(event.target.value)} />}
      </Field>
      <Field label="Pairing code from the other server" hint="Receive here → Make a pairing code, on that server.">
        {(control) => <input {...control} autoComplete="off" spellCheck={false} className="field-input font-mono" value={code} onChange={(event) => setCode(event.target.value)} />}
      </Field>
      <div className="flex items-end">
        <Button type="submit" loading={pending} loadingLabel="Starting…" disabled={busy || !name || !url || !code} icon={<Send aria-hidden="true" className="h-4 w-4" />}>
          Send the package
        </Button>
      </div>
    </form>
  );
}

function PullForm({ busy, onStart, onError }: StartProps) {
  const [url, setUrl] = useState("");
  const [code, setCode] = useState("");
  const { pending, submit } = useSubmit(onError);
  return (
    <form
      className="grid gap-3 sm:grid-cols-3"
      onSubmit={(event) => {
        event.preventDefault();
        void submit(() => onStart({ action: "pull", url, code }, code));
      }}
    >
      <Field label="The other server's address" hint="The server that offered a package.">
        {(control) => <input {...control} type="url" inputMode="url" autoComplete="off" className="field-input" value={url} onChange={(event) => setUrl(event.target.value)} />}
      </Field>
      <Field label="Its pairing code">
        {(control) => <input {...control} autoComplete="off" spellCheck={false} className="field-input font-mono" value={code} onChange={(event) => setCode(event.target.value)} />}
      </Field>
      <div className="flex items-end">
        <Button type="submit" loading={pending} loadingLabel="Starting…" disabled={busy || !url || !code}>
          Pull the package here
        </Button>
      </div>
    </form>
  );
}

function LinkForm({ busy, onStart, onError }: StartProps) {
  const [url, setUrl] = useState("");
  const { pending, submit } = useSubmit(onError);
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        void submit(() => onStart({ action: "url-fetch", url }, ""));
      }}
    >
      <Field label="Address of a .arsbak file (https)" hint="e.g. a shared-link or pre-signed storage link. It is kept in the server's memory only while copying." className="min-w-[18rem] flex-1">
        {(control) => <input {...control} type="url" inputMode="url" autoComplete="off" className="field-input" value={url} onChange={(event) => setUrl(event.target.value)} />}
      </Field>
      <Button type="submit" loading={pending} loadingLabel="Starting…" disabled={busy || !url} icon={<Link2 aria-hidden="true" className="h-4 w-4" />}>
        Copy it here
      </Button>
    </form>
  );
}

function DatabaseForm({ busy, onStart, onError }: StartProps) {
  const [form, setForm] = useState({ host: "", port: "3306", user: "", password: "", database: "", confirm: "", targetKey: "" });
  const { pending, submit } = useSubmit(onError);
  const set = (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement>) => setForm((current) => ({ ...current, [key]: event.target.value }));
  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        void submit(() => onStart({ action: "db-copy", host: form.host.trim(), port: Number(form.port), user: form.user.trim(), password: form.password, database: form.database.trim(), confirm: form.confirm, ...(form.targetKey.trim() ? { targetKey: form.targetKey.trim() } : {}) }, form.password));
      }}
    >
      <p className="text-label text-ink-muted">
        Copies this database straight into another MySQL database (its tables are replaced; a safety snapshot of it is made first and kept here). Attachments don&apos;t go this way: send a full package (or Attachments only) too. The other server must allow this server&apos;s address (cPanel → Remote MySQL). The details are used only while copying; the password is never stored.
      </p>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Host">{(control) => <input {...control} autoComplete="off" className="field-input" value={form.host} onChange={set("host")} />}</Field>
        <Field label="Port">{(control) => <input {...control} inputMode="numeric" className="field-input" value={form.port} onChange={set("port")} />}</Field>
        <Field label="Database">{(control) => <input {...control} autoComplete="off" className="field-input" value={form.database} onChange={set("database")} />}</Field>
        <Field label="User">{(control) => <input {...control} autoComplete="off" className="field-input" value={form.user} onChange={set("user")} />}</Field>
        <Field label="Password">{(control) => <input {...control} type="password" autoComplete="off" className="field-input" value={form.password} onChange={set("password")} />}</Field>
        <Field label="The other app's ENCRYPTION_KEY" optional hint="To re-key stored provider keys for it. Empty: set its ENCRYPTION_KEY to this server's instead.">
          {(control) => <input {...control} type="password" autoComplete="off" className="field-input" value={form.targetKey} onChange={set("targetKey")} />}
        </Field>
      </div>
      <Field label={`Type the target database's name to confirm${form.database ? `: ${form.database}` : ""}`} hint="Everything in it is replaced.">
        {(control) => <input {...control} autoComplete="off" spellCheck={false} className="field-input max-w-sm" value={form.confirm} onChange={set("confirm")} />}
      </Field>
      <Button type="submit" variant="danger" loading={pending} loadingLabel="Connecting…" disabled={busy || !form.host || !form.user || !form.database || form.confirm.trim() !== form.database.trim()} icon={<Database aria-hidden="true" className="h-4 w-4" />}>
        Copy the database there
      </Button>
    </form>
  );
}

export function LiveCheckResult({ run }: { run: RunView }) {
  const summary = run.summary as { rows?: { table: string; expected: number; now: number }[]; filesOk?: number; filesBad?: string[]; checks?: { name: string; ok: boolean; detail: string }[] } | null;
  if (!summary) return null;
  const differ = (summary.rows ?? []).filter((row) => row.now !== row.expected);
  return (
    <section aria-labelledby="bk-live" className="card px-5 py-4">
      <h2 id="bk-live" className="font-semibold">
        Check after the move
      </h2>
      <p className="mt-1 text-label text-ink-muted">{run.message}</p>
      <ul className="mt-3 space-y-1 text-label">
        {(summary.checks ?? []).map((check) => (
          <li key={check.name}>
            <Badge tone={check.ok ? "success" : "warning"}>{check.ok ? "OK" : "Fix"}</Badge> {check.name}: {check.detail}
          </li>
        ))}
        <li>
          <Badge tone={(summary.filesBad ?? []).length ? "warning" : "success"}>{(summary.filesBad ?? []).length ? "Fix" : "OK"}</Badge> Attachments: {summary.filesOk ?? 0} match their checksums{(summary.filesBad ?? []).length ? `; missing or different: ${(summary.filesBad ?? []).slice(0, 5).join(", ")}` : ""}
        </li>
        <li>
          <Badge tone={differ.length ? "neutral" : "success"}>{differ.length ? "Note" : "OK"}</Badge> Rows: {(summary.rows ?? []).length - differ.length} of {(summary.rows ?? []).length} tables as in the package
          {differ.length ? ` (changed since: ${differ.slice(0, 6).map((row) => `${row.table} ${row.expected} → ${row.now}`).join(", ")})` : ""}
        </li>
      </ul>
    </section>
  );
}
