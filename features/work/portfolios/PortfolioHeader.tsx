"use client";

import { Archive, Briefcase, ChevronDown, Copy, Download, Info, Link2, LogOut, Palette, Printer, Settings, Settings2, Share2, Trash2, Lock, X } from "lucide-react";
import { useId, useState } from "react";
import { addPortfolioFieldAction, portfolioCommandAction, portfolioMemberAction, removePortfolioFieldAction, updatePortfolioAction } from "@/app/users/work/portfolio-actions";
import { Dialog, ConfirmDialog } from "@/features/ui/Dialog";
import { Menu, type MenuItem } from "@/features/ui/Menu";
import { initials } from "@/features/ui/Display";
import { useToast } from "@/features/ui/Toast";
import { PersonSelect, type PersonChoice } from "@/features/ui/PersonSelect";
import { COPY_BLOCKED, copyText } from "@/features/ui/clipboard";
import { COLOR_HEX, useWorkCall } from "@/features/work/client";
import { DateRangePicker } from "@/features/ui/DateRangePicker";
import { PortfolioStar } from "@/features/work/portfolios/PortfolioParts";
import { PRIVACY, PRIVACY_LABEL, PROJECT_COLORS, PROJECT_ROLE_LABEL, PROJECT_ROLES, STATUS_KIND_LABEL, STATUS_KINDS, type ProjectRole, type ProjectStatusKind } from "@/server/work/access";
import { FIELD_KIND_LABEL, FIELD_KINDS, PORTFOLIO_ROLE_HELP, type PortfolioFieldKind } from "@/server/work/portfolio-rules";

// v1.69.0 (D-382, spec PORTFOLIOS §3.4, 3.13-3.15): the portfolio header:
// colour tile, name, actions menu, star, status pill, people, Share and
// Customize (its own columns). Every change is checked again on the server.
const STATUS_DOT: Record<ProjectStatusKind, string> = {
  ON_TRACK: "bg-success-600",
  AT_RISK: "bg-warning-600",
  OFF_TRACK: "bg-danger-600",
  ON_HOLD: "bg-info-600",
  COMPLETE: "bg-primary-solid",
  DROPPED: "bg-ink-faint",
};
const COLOR_LABEL: Record<string, string> = { green: "Green", blue: "Blue", teal: "Teal", amber: "Amber", red: "Orange", purple: "Purple", pink: "Pink", gray: "Grey" };
type Can = { view: boolean; manage: boolean; share: boolean; edit: boolean };
export interface HeaderPortfolio {
  id: number;
  name: string;
  color: string;
  status: ProjectStatusKind | null;
  privacy: string;
  departmentId: number | null;
  description: string;
  startOn: string | null;
  dueOn: string | null;
  ownerId: number;
  defaultTab: string;
  defaultAccessRole: string;
  archived: boolean;
  rowVersion: number;
}

export function PortfolioHeader({
  portfolio,
  meta,
  starred,
  members,
  fields,
  can,
  isMember,
  meId,
  people,
  departments,
}: {
  portfolio: HeaderPortfolio;
  meta: string;
  starred: boolean;
  members: { id: number; name: string; role: ProjectRole }[];
  fields: { id: number; name: string; kind: PortfolioFieldKind; options: string[] }[];
  can: Can;
  isMember: boolean;
  meId: number;
  people: PersonChoice[];
  departments: { id: number; name: string }[];
}) {
  const toast = useToast();
  const { call } = useWorkCall();
  const [open, setOpen] = useState<"details" | "share" | "customize" | "delete" | null>(null);
  const base = `/users/work/portfolios/${portfolio.id}`;
  const close = () => setOpen(null);
  const copyLink = () => {
    const link = `${window.location.origin}${base}`;
    void copyText(link).then((done) => toast(done ? { tone: "success", title: "Portfolio link copied." } : { tone: "error", title: `${COPY_BLOCKED} ${link}` }));
  };
  // v1.73.0 (D-396, spec PORTFOLIOS §3.13): the actions in the spec's order:
  // portfolio details, Copy portfolio link, Set colour (with the current one),
  // Export or sync › Print, then Archive, Leave and Delete (owners only where
  // the spec says admins). Editors see a note that some items are for owners.
  const actions: MenuItem[] = [
    ...(can.manage ? [{ label: "Edit portfolio details", icon: <Settings className="h-4 w-4" />, onSelect: () => setOpen("details") }] : []),
    { label: "Copy portfolio link", icon: <Link2 className="h-4 w-4" />, onSelect: copyLink },
    ...(can.edit ? [{ label: "Set colour", icon: <Palette className="h-4 w-4" style={{ color: COLOR_HEX[portfolio.color] ?? COLOR_HEX.gray }} />, hint: COLOR_LABEL[portfolio.color] ?? undefined, onSelect: () => setOpen("details") }] : []),
    { kind: "submenu" as const, label: "Export or sync", icon: <Download className="h-4 w-4" />, testId: "portfolio-export", items: [{ label: "Print", icon: <Printer className="h-4 w-4" />, onSelect: () => window.print() }] },
    ...(can.manage || isMember ? [{ kind: "separator" as const, label: "" }] : []),
    ...(can.manage ? [{ label: portfolio.archived ? "Restore from archive" : "Archive", icon: <Archive className="h-4 w-4" />, onSelect: () => void call(() => portfolioCommandAction(portfolio.id, portfolio.archived ? "UNARCHIVE" : "ARCHIVE")) }] : []),
    ...(isMember && !can.manage ? [{ label: "Leave portfolio", icon: <LogOut className="h-4 w-4" />, onSelect: () => void call(() => portfolioCommandAction(portfolio.id, "LEAVE")) }] : []),
    ...(can.manage ? [{ label: "Delete portfolio", icon: <Trash2 className="h-4 w-4" />, tone: "danger" as const, onSelect: () => setOpen("delete") }] : []),
  ];
  const statuses: MenuItem[] = STATUS_KINDS.map((kind) => ({ label: STATUS_KIND_LABEL[kind], hint: portfolio.status === kind ? "Current status" : undefined, icon: <span aria-hidden="true" className={`inline-block h-2.5 w-2.5 rounded-full ${STATUS_DOT[kind]}`} />, href: `${base}?tab=progress&status=${kind}#post-status` }));
  const pill = (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-line px-2.5 py-0.5 text-caption">
      <span aria-hidden="true" className={`h-2 w-2 rounded-full ${portfolio.status ? STATUS_DOT[portfolio.status] : "border border-ink-faint"}`} />
      {portfolio.status ? STATUS_KIND_LABEL[portfolio.status] : can.edit ? "Set status" : "No recent updates"}
    </span>
  );
  return (
    <header className="mb-4 flex flex-wrap items-center gap-3" data-testid="portfolio-header">
      <span aria-hidden="true" className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-on-solid" style={{ backgroundColor: COLOR_HEX[portfolio.color] ?? COLOR_HEX.gray }}>
        <Briefcase className="h-4 w-4" />
      </span>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-1">
          <h1 className="truncate text-title font-semibold tracking-tight">{portfolio.name}</h1>
          <Menu
            label={`Actions for ${portfolio.name}`}
            trigger={<ChevronDown aria-hidden="true" className="h-4 w-4" />}
            items={actions}
            align="left"
            menuClass="w-64"
            testId="portfolio-actions"
            header={
              can.edit && !can.manage ? (
                <p className="flex items-start gap-2 px-3 py-2 text-caption text-ink-muted">
                  <Info aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0" /> Some actions are for the portfolio&apos;s owners only.
                </p>
              ) : undefined
            }
          />
          <PortfolioStar portfolioId={portfolio.id} starred={starred} name={portfolio.name} />
          {can.edit ? <Menu label={portfolio.status ? `Set a status. Current status: ${STATUS_KIND_LABEL[portfolio.status]}` : "Set a status. Current status: No recent updates"} trigger={pill} items={statuses} align="left" testId="portfolio-status-menu" /> : pill}
        </div>
        <p className="text-caption text-ink-muted">{meta}</p>
      </div>
      <div className="ml-auto flex flex-wrap items-center gap-2">
        {/* v1.73.0 (D-396, spec §3.4 #6): the avatars are the "Manage portfolio members" button (the Share dialog). */}
        <button type="button" onClick={() => setOpen("share")} className="flex -space-x-1.5 rounded-full hover:opacity-90" aria-label={`Manage portfolio members (${members.length} member${members.length === 1 ? "" : "s"})`} title="Manage portfolio members" data-testid="portfolio-members">
          {members.slice(0, 5).map((member) => (
            <span key={member.id} title={member.name} className="inline-flex h-7 w-7 items-center justify-center rounded-full border-2 border-surface bg-primary-50 text-[length:calc(10px*var(--text-scale,1))] font-semibold text-primary-700">
              {initials(member.name)}
            </span>
          ))}
          {members.length > 5 && <span className="inline-flex h-7 min-w-7 items-center justify-center rounded-full border-2 border-surface bg-surface-muted px-1 text-caption">+{members.length - 5}</span>}
        </button>
        <button type="button" className="btn-secondary btn-compact inline-flex items-center gap-1" onClick={() => setOpen("share")} data-testid="portfolio-share">
          {portfolio.privacy === "PRIVATE" ? <Lock aria-hidden="true" className="h-4 w-4" /> : <Share2 aria-hidden="true" className="h-4 w-4" />} Share
        </button>
        {can.edit && (
          <button type="button" className="btn-secondary btn-compact inline-flex items-center gap-1" onClick={() => setOpen("customize")} data-testid="portfolio-customize">
            <Settings2 aria-hidden="true" className="h-4 w-4" /> Customize
          </button>
        )}
      </div>
      <Dialog open={open === "details"} onClose={close} title={can.manage ? "Portfolio details" : "Portfolio colour"} size="md">
        {open === "details" && <DetailsForm portfolio={portfolio} members={members} departments={departments} manage={can.manage} onDone={close} />}
      </Dialog>
      <Dialog open={open === "share"} onClose={close} title={`Share ${portfolio.name}`} description={portfolio.privacy === "PRIVATE" ? "Private to portfolio members." : `Visible to ${PRIVACY_LABEL[portfolio.privacy as keyof typeof PRIVACY_LABEL].toLowerCase()}.`} size="md">
        {open === "share" && <ShareForm portfolioId={portfolio.id} members={members} people={people} can={can} meId={meId} onCopy={copyLink} />}
      </Dialog>
      <Dialog open={open === "customize"} onClose={close} title="Customize: columns" description="Columns of this portfolio's List, with a value for each project or portfolio in it." size="md">
        {open === "customize" && <ColumnsForm portfolioId={portfolio.id} fields={fields} />}
      </Dialog>
      <ConfirmDialog
        open={open === "delete"}
        onCancel={close}
        onConfirm={() => void call(() => portfolioCommandAction(portfolio.id, "DELETE")).then((result) => result?.ok && window.location.assign("/users/work/portfolios?show=deleted"))}
        title={`Delete ${portfolio.name}?`}
        body="It goes to Deleted for 30 days, then it is removed for good. Its projects and sub-portfolios are not touched."
        confirmLabel="Delete portfolio"
        tone="danger"
      />
    </header>
  );
}

function DetailsForm({ portfolio, members, departments, manage, onDone }: { portfolio: HeaderPortfolio; members: { id: number; name: string; role: ProjectRole }[]; departments: { id: number; name: string }[]; manage: boolean; onDone: () => void }) {
  const { call, pending } = useWorkCall();
  const id = useId();
  const [name, setName] = useState(portfolio.name);
  const [color, setColor] = useState(portfolio.color);
  const [description, setDescription] = useState(portfolio.description);
  const [privacy, setPrivacy] = useState(portfolio.privacy);
  const [department, setDepartment] = useState<number | "">(portfolio.departmentId ?? "");
  const [accessRole, setAccessRole] = useState(portfolio.defaultAccessRole);
  const [startOn, setStartOn] = useState(portfolio.startOn ?? "");
  const [dueOn, setDueOn] = useState(portfolio.dueOn ?? "");
  const [ownerId, setOwnerId] = useState(portfolio.ownerId);
  const [tab, setTab] = useState(portfolio.defaultTab);
  const save = () =>
    void call(() =>
      updatePortfolioAction(
        portfolio.id,
        manage
          ? { name, color, description, privacy, departmentId: privacy === "DEPARTMENT" && department !== "" ? department : null, defaultAccessRole: accessRole, startOn, dueOn, ownerId, defaultTab: tab, rowVersion: portfolio.rowVersion }
          : { color },
      ),
    ).then((result) => result?.ok && onDone());
  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        save();
      }}
    >
      {manage && (
        <div>
          <label htmlFor={`${id}-name`} className="field-label">
            Name
          </label>
          <input id={`${id}-name`} value={name} onChange={(event) => setName(event.target.value)} maxLength={150} required className="field-input" />
        </div>
      )}
      <fieldset>
        <legend className="field-label">Colour</legend>
        <div className="flex flex-wrap gap-2">
          {PROJECT_COLORS.map((key) => (
            <label key={key} title={COLOR_LABEL[key]} className="cursor-pointer">
              <input type="radio" name={`${id}-color`} value={key} checked={color === key} onChange={() => setColor(key)} className="peer sr-only" aria-label={COLOR_LABEL[key]} />
              <span aria-hidden="true" className="block h-7 w-7 rounded-md ring-offset-2 ring-offset-surface peer-checked:ring-2 peer-checked:ring-primary-600 peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-primary-600" style={{ backgroundColor: COLOR_HEX[key] }} />
            </label>
          ))}
        </div>
      </fieldset>
      {manage && (
        <>
          <div>
            <label htmlFor={`${id}-desc`} className="field-label">
              Description <span className="font-normal text-ink-faint">(optional)</span>
            </label>
            <textarea id={`${id}-desc`} value={description} onChange={(event) => setDescription(event.target.value)} maxLength={4000} rows={3} className="field-input" />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {/* v1.75.0 (D-399): the portfolio's start and due dates in the shared date range picker. */}
            <div className="sm:col-span-2">
              <span className="field-label">Dates</span>
              <DateRangePicker
                idBase={id}
                label="Portfolio dates"
                value={{ start: startOn, due: dueOn }}
                onChange={(next) => {
                  setStartOn(next.start);
                  setDueOn(next.due);
                }}
                placeholder="Choose the start and due dates"
                testId="portfolio-dates"
              />
            </div>
            <div>
              <label htmlFor={`${id}-owner`} className="field-label">
                Portfolio owner
              </label>
              <select id={`${id}-owner`} value={ownerId} onChange={(event) => setOwnerId(Number(event.target.value))} className="field-input">
                {members
                  .filter((member) => member.role === "OWNER")
                  .map((member) => (
                    <option key={member.id} value={member.id}>
                      {member.name}
                    </option>
                  ))}
              </select>
            </div>
            <div>
              <label htmlFor={`${id}-tab`} className="field-label">
                Opens on
              </label>
              <select id={`${id}-tab`} value={tab} onChange={(event) => setTab(event.target.value)} className="field-input">
                <option value="LIST">List</option>
                <option value="TIMELINE">Timeline</option>
                <option value="PROGRESS">Progress</option>
                <option value="DASHBOARD">Dashboard</option>
              </select>
            </div>
            <div>
              <label htmlFor={`${id}-privacy`} className="field-label">
                Who can see it
              </label>
              <select id={`${id}-privacy`} value={privacy} onChange={(event) => setPrivacy(event.target.value)} className="field-input">
                {PRIVACY.map((key) => (
                  <option key={key} value={key}>
                    {key === "PRIVATE" ? "Private to portfolio members" : PRIVACY_LABEL[key]}
                  </option>
                ))}
              </select>
            </div>
            {privacy === "DEPARTMENT" && (
              <div>
                <label htmlFor={`${id}-dept`} className="field-label">
                  Department
                </label>
                <select id={`${id}-dept`} value={department} onChange={(event) => setDepartment(event.target.value ? Number(event.target.value) : "")} className="field-input">
                  <option value="">Choose…</option>
                  {departments.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {privacy !== "PRIVATE" && (
              <div>
                <label htmlFor={`${id}-access`} className="field-label">
                  Their role
                </label>
                <select id={`${id}-access`} value={accessRole} onChange={(event) => setAccessRole(event.target.value)} className="field-input">
                  {(["EDITOR", "COMMENTER", "VIEWER"] as const).map((key) => (
                    <option key={key} value={key}>
                      {PROJECT_ROLE_LABEL[key]}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
          <p className="text-caption text-ink-muted">Whoever can see the portfolio still sees only the projects they already have access to.</p>
        </>
      )}
      <button type="submit" className="btn-primary" disabled={pending}>
        Save
      </button>
    </form>
  );
}

function ShareForm({ portfolioId, members, people, can, meId, onCopy }: { portfolioId: number; members: { id: number; name: string; role: ProjectRole }[]; people: PersonChoice[]; can: Can; meId: number; onCopy: () => void }) {
  const { call, pending } = useWorkCall();
  const id = useId();
  const [who, setWho] = useState<number | null>(null);
  const [role, setRole] = useState<ProjectRole>("EDITOR");
  const roles = PROJECT_ROLES.filter((key) => key !== "OWNER" || can.manage);
  return (
    <div className="space-y-4">
      {can.share && (
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-48 flex-1">
            <span className="field-label">Add people</span>
            <PersonSelect ariaLabel="Person to add" options={people.filter((person) => !members.some((member) => member.id === person.id))} value={who} onChange={setWho} placeholder="Choose a person…" testId="share-person" />
          </div>
          <div>
            <label htmlFor={`${id}-role`} className="field-label">
              Role
            </label>
            <select id={`${id}-role`} value={role} onChange={(event) => setRole(event.target.value as ProjectRole)} className="field-input">
              {roles.map((key) => (
                <option key={key} value={key}>
                  {PROJECT_ROLE_LABEL[key]}
                </option>
              ))}
            </select>
          </div>
          <button type="button" className="btn-primary" disabled={pending || who === null} onClick={() => who !== null && void call(() => portfolioMemberAction(portfolioId, who, role)).then((result) => result?.ok && setWho(null))} data-testid="share-invite">
            Invite
          </button>
        </div>
      )}
      <p className="text-caption text-ink-muted">{PORTFOLIO_ROLE_HELP[role]} Being in a portfolio never opens its projects.</p>
      <div>
        <h3 className="mb-1 text-caption font-semibold text-ink-faint">Who has access</h3>
        <ul className="divide-y divide-line rounded-md border border-line" data-testid="share-members">
          {members.map((member) => {
            const editable = can.share && member.id !== meId && (member.role !== "OWNER" || can.manage);
            return (
              <li key={member.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-label">
                <span className="flex-1">{member.name}</span>
                {editable ? (
                  <>
                    <label className="sr-only" htmlFor={`${id}-m${member.id}`}>
                      Role of {member.name}
                    </label>
                    <select id={`${id}-m${member.id}`} value={member.role} disabled={pending} onChange={(event) => void call(() => portfolioMemberAction(portfolioId, member.id, event.target.value))} className="field-input h-8 w-auto text-label">
                      {roles.map((key) => (
                        <option key={key} value={key}>
                          {PROJECT_ROLE_LABEL[key]}
                        </option>
                      ))}
                    </select>
                    <button type="button" aria-label={`Remove ${member.name}`} disabled={pending} className="rounded p-1 text-ink-muted hover:text-danger-600" onClick={() => void call(() => portfolioMemberAction(portfolioId, member.id, null))}>
                      <X aria-hidden="true" className="h-4 w-4" />
                    </button>
                  </>
                ) : (
                  <span className="text-ink-muted">{PROJECT_ROLE_LABEL[member.role]}</span>
                )}
              </li>
            );
          })}
        </ul>
      </div>
      <button type="button" className="btn-secondary btn-compact inline-flex items-center gap-1" onClick={onCopy}>
        <Copy aria-hidden="true" className="h-4 w-4" /> Copy portfolio link
      </button>
    </div>
  );
}

function ColumnsForm({ portfolioId, fields }: { portfolioId: number; fields: { id: number; name: string; kind: PortfolioFieldKind; options: string[] }[] }) {
  const { call, pending } = useWorkCall();
  const id = useId();
  const [name, setName] = useState("");
  const [kind, setKind] = useState<PortfolioFieldKind>("TEXT");
  const [options, setOptions] = useState("");
  return (
    <div className="space-y-4">
      {fields.length > 0 ? (
        <ul className="divide-y divide-line rounded-md border border-line" data-testid="portfolio-columns">
          {fields.map((field) => (
            <li key={field.id} className="flex items-center gap-2 px-3 py-2 text-label">
              <span className="flex-1">
                {field.name} <span className="text-caption text-ink-muted">· {FIELD_KIND_LABEL[field.kind]}</span>
              </span>
              <button type="button" aria-label={`Remove the column ${field.name}`} disabled={pending} className="rounded p-1 text-ink-muted hover:text-danger-600" onClick={() => void call(() => removePortfolioFieldAction(portfolioId, field.id))}>
                <Trash2 aria-hidden="true" className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-label text-ink-muted">No columns of its own yet. Name, Status, Task progress, Due date, Owner and Priority are always there.</p>
      )}
      <form
        className="space-y-3 rounded-md border border-line p-3"
        onSubmit={(event) => {
          event.preventDefault();
          void call(() => addPortfolioFieldAction(portfolioId, { name, kind, options: kind === "SELECT" ? options.split(",").map((item) => item.trim()).filter(Boolean) : [] })).then((result) => {
            if (result?.ok) {
              setName("");
              setOptions("");
            }
          });
        }}
      >
        <h3 className="font-medium">Add a column</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor={`${id}-name`} className="field-label">
              Column name
            </label>
            <input id={`${id}-name`} value={name} onChange={(event) => setName(event.target.value)} maxLength={80} required className="field-input" data-testid="column-name" />
          </div>
          <div>
            <label htmlFor={`${id}-kind`} className="field-label">
              Type
            </label>
            <select id={`${id}-kind`} value={kind} onChange={(event) => setKind(event.target.value as PortfolioFieldKind)} className="field-input" data-testid="column-kind">
              {FIELD_KINDS.map((key) => (
                <option key={key} value={key}>
                  {FIELD_KIND_LABEL[key]}
                </option>
              ))}
            </select>
          </div>
        </div>
        {kind === "SELECT" && (
          <div>
            <label htmlFor={`${id}-options`} className="field-label">
              Options, separated by commas
            </label>
            <input id={`${id}-options`} value={options} onChange={(event) => setOptions(event.target.value)} className="field-input" placeholder="e.g. Plan, Build, Run" data-testid="column-options" />
          </div>
        )}
        <button type="submit" className="btn-primary btn-compact" disabled={pending || !name.trim()} data-testid="column-add">
          Add column
        </button>
      </form>
    </div>
  );
}
