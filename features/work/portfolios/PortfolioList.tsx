"use client";

import { formatDate } from "@/lib/format/date";
import { ArrowDown, ArrowUp, Briefcase, ChevronDown, ExternalLink, Filter, FolderKanban, Group, Link2, Lock, MoreHorizontal, Plus, Trash2, X } from "lucide-react";
import { Menu, type MenuItem } from "@/features/ui/Menu";
import { useToast } from "@/features/ui/Toast";
import { COPY_BLOCKED, copyText } from "@/features/ui/clipboard";
import { SortMenu, ViewSearch } from "@/features/work/ViewToolbar";
import Link from "next/link";
import { Fragment, useId, useMemo, useRef, useState } from "react";
import { addWorkAction, portfolioValueAction, priorityAction, removeWorkAction } from "@/app/users/work/portfolio-actions";
import { PersonSelect } from "@/features/ui/PersonSelect";
import { ProjectDot, useWorkCall } from "@/features/work/client";
import { ProgressMeter } from "@/features/work/portfolios/PortfolioParts";
import { STATUS_KIND_LABEL, type ProjectStatusKind } from "@/server/work/access";
import {
  filterRows,
  GROUP_LABEL,
  GROUPS,
  groupRows,
  maskedName,
  PRIORITIES,
  PRIORITY_LABEL,
  progressOf,
  QUICK_FILTER_LABEL,
  QUICK_FILTERS,
  SORT_LABEL,
  SORTS,
  sortRows,
  type PortfolioFieldKind,
  type PortfolioGroup,
  type PortfolioRow,
  type PortfolioSort,
  type QuickFilter,
  type VisibleRow,
} from "@/server/work/portfolio-rules";

// v1.69.0 (D-382, spec PORTFOLIOS §3.5, 3.8-3.11): the portfolio's List:
// one row per project or sub-portfolio with its latest status, task progress
// (a bar and "4 of 6 tasks done (66%)"), due date, owner, priority and the
// portfolio's own columns. Filter, sort, group and search; owners and
// editors add work (a combobox over what they can see) and remove rows.
// Rows the person can't see read "Private project" with who added it.
const STATUS_DOT: Record<ProjectStatusKind, string> = {
  ON_TRACK: "bg-success-600",
  AT_RISK: "bg-warning-600",
  OFF_TRACK: "bg-danger-600",
  ON_HOLD: "bg-info-600",
  COMPLETE: "bg-primary-solid",
  DROPPED: "bg-ink-faint",
};
export const dayWords = (day: string | null) => formatDate(day, { empty: "—" });
interface Field {
  id: number;
  name: string;
  kind: PortfolioFieldKind;
  options: string[];
}
type Choice = { key: string; kind: "project" | "portfolio"; id: number; name: string; color: string; detail?: string };

export function StatusPill({ status }: { status: ProjectStatusKind | null }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-label">
      <span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-full ${status ? STATUS_DOT[status] : "border border-ink-faint"}`} />
      {status ? STATUS_KIND_LABEL[status] : <span className="text-ink-muted">No recent updates</span>}
    </span>
  );
}

export function PortfolioList({
  portfolioId,
  rows,
  fields,
  canEdit,
  meId,
  people,
  choices,
  durations = null,
}: {
  // v1.74.0 (D-398, "pm_planning"): each row's "10 working days · 80 h" by item id (null: off).
  durations?: Record<number, string | null> | null;
  portfolioId: number;
  rows: PortfolioRow[];
  fields: Field[];
  canEdit: boolean;
  meId: number;
  people: { id: number; label: string }[];
  choices: { projects: { id: number; name: string; color: string }[]; portfolios: { id: number; name: string; color: string; items: number }[] };
}) {
  const [filter, setFilter] = useState<QuickFilter>("all");
  const [sort, setSort] = useState<PortfolioSort>("manual");
  const [descending, setDescending] = useState(false);
  const [group, setGroup] = useState<PortfolioGroup>("none");
  const [query, setQuery] = useState("");
  const shown = useMemo(() => groupRows(sortRows(filterRows(rows, filter, meId, query), sort, descending), group, (status) => STATUS_KIND_LABEL[status]), [rows, filter, meId, query, sort, descending, group]);
  const count = shown.reduce((sum, item) => sum + item.rows.length, 0);
  const columns = 8 + fields.length + (durations ? 1 : 0);
  const inList = new Set(rows.filter((row): row is VisibleRow => !row.masked).map((row) => `${row.kind === "PROJECT" ? "project" : "portfolio"}:${row.id}`));
  return (
    <section aria-label="List" data-testid="portfolio-list-tab">
      {/* v1.73.0 (D-396, spec PORTFOLIOS §3.5, §3.9-§3.11): Add work ▾ on the left; Filter, Sort, Group and Search this view on the right, as dropdown menus. */}
      <div className="mb-3 flex flex-wrap items-start gap-2" role="toolbar" aria-label="Portfolio list tools">
        {canEdit && (
          <span className="inline-flex items-start gap-0">
            <AddWork portfolioId={portfolioId} choices={choices} exclude={inList} />
            <Menu
              label="More ways to add work"
              trigger={<ChevronDown aria-hidden="true" className="h-4 w-4" />}
              buttonClass="btn-secondary btn-compact ml-1 px-1.5"
              align="left"
              menuClass="w-56"
              testId="add-work-more"
              items={[
                { label: "Create new project", icon: <FolderKanban className="h-4 w-4" />, href: "/users/work/projects/new" },
                { label: "Create new portfolio", icon: <Briefcase className="h-4 w-4" />, href: "/users/work/portfolios/new" },
              ]}
            />
          </span>
        )}
        <div className="ml-auto flex flex-wrap items-center gap-1">
          <span className={filter !== "all" ? "tb-pill" : "inline-flex items-center"}>
            <Menu
              label={filter !== "all" ? `Filters: 1, ${QUICK_FILTER_LABEL[filter]}` : "Filter"}
              trigger={
                <>
                  <Filter aria-hidden="true" className="h-4 w-4" /> {filter !== "all" ? "Filters: 1" : "Filter"}
                </>
              }
              buttonClass="tb-btn"
              menuClass="w-56"
              testId="portfolio-filter"
              items={[
                { kind: "heading", label: "Quick filters" },
                ...QUICK_FILTERS.filter((key) => key !== "all").map((key): MenuItem => ({ kind: "radio", label: QUICK_FILTER_LABEL[key], checked: filter === key, onSelect: () => setFilter(filter === key ? "all" : key), testId: `filter-${key}` })),
                { kind: "separator", label: "" },
                { label: "Clear", icon: <X className="h-4 w-4" />, disabled: filter === "all", onSelect: () => setFilter("all"), testId: "filter-clear" },
              ]}
            />
          </span>
          <SortMenu
            entries={SORT_ORDER.map((key) => ({ key, label: key === "manual" ? "None (order added)" : key === "name" ? "Alphabetical" : SORT_LABEL[key] }))}
            current={sort}
            dir={descending ? "desc" : "asc"}
            onPick={(key) => setSort(key as PortfolioSort)}
            onDir={(dir) => setDescending(dir === "desc")}
            onClear={() => {
              setSort("manual");
              setDescending(false);
            }}
          />
          <span className={group !== "none" ? "tb-pill" : "inline-flex items-center"}>
            <Menu
              label={group !== "none" ? `Group: ${GROUP_LABEL[group]}` : "Group"}
              trigger={
                <>
                  <Group aria-hidden="true" className="h-4 w-4" /> {group !== "none" ? `Group: ${GROUP_LABEL[group]}` : "Group"}
                </>
              }
              buttonClass="tb-btn"
              menuClass="w-56"
              testId="portfolio-group"
              items={[
                ...GROUP_ORDER.map((key): MenuItem => ({ kind: "radio", label: GROUP_LABEL[key], checked: group === key, onSelect: () => setGroup(key), testId: `group-${key}` })),
                { kind: "separator", label: "" },
                { label: "Clear", icon: <X className="h-4 w-4" />, disabled: group === "none", onSelect: () => setGroup("none"), testId: "group-clear" },
              ]}
            />
          </span>
          <ViewSearch value={query} onChange={setQuery} />
        </div>
      </div>
      <p className="sr-only" role="status" aria-live="polite">
        {count} {count === 1 ? "row" : "rows"} shown
      </p>
      {rows.length === 0 ? (
        <p className="card px-4 py-8 text-center text-label text-ink-muted" data-testid="portfolio-empty">
          Nothing in this portfolio yet.{canEdit ? " Use Add work to add a project or a portfolio." : ""}
        </p>
      ) : (
        <div className="table-cards">
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[56rem] text-left text-label" data-testid="portfolio-grid" data-cards>
            <caption className="sr-only">Projects and portfolios in this portfolio</caption>
            <thead className="border-b border-line text-caption text-ink-muted">
              <tr>
                {(
                  [
                    ["Name", "name", null],
                    ["Status", "status", "status"],
                    ["Task progress", "progress", null],
                    [durations ? "Dates" : "Due date", "due", null],
                    ["Owner", "owner", "owner"],
                    ["Priority", "priority", "priority"],
                  ] as const
                ).flatMap(([label, sortKey, groupKey]) => [
                  ...(label === "Owner" && durations
                    ? [
                        <th key="duration" scope="col" className="px-3 py-2 font-medium" data-testid="duration-column">
                          Duration
                        </th>,
                      ]
                    : []),
                  (
                  <ColumnHead
                    key={label}
                    label={label}
                    sorted={sort === sortKey ? (descending ? "desc" : "asc") : null}
                    onSort={(dir) => {
                      setSort(sortKey);
                      setDescending(dir === "desc");
                    }}
                    grouped={groupKey ? group === groupKey : null}
                    onGroup={groupKey ? () => setGroup(group === groupKey ? "none" : groupKey) : null}
                  />
                  ),
                ])}
                {fields.map((field) => (
                  <th key={field.id} scope="col" className="px-3 py-2 font-medium">
                    {field.name}
                  </th>
                ))}
                <th scope="col" className="px-3 py-2 font-medium">
                  <span className="sr-only">Overdue</span>
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {shown.map((section) => (
                <Fragment key={section.key}>
                  {group !== "none" && (
                    <tr className="bg-surface-muted">
                      <th scope="colgroup" colSpan={columns} className="px-3 py-1.5 text-left text-caption font-semibold">
                        {section.label} <span className="font-normal text-ink-muted">({section.rows.length})</span>
                      </th>
                    </tr>
                  )}
                  {section.rows.map((row) => (row.masked ? <MaskedLine key={row.itemId} row={row} columns={columns} canEdit={canEdit} portfolioId={portfolioId} /> : <Line key={row.itemId} row={row} fields={fields} canEdit={canEdit} portfolioId={portfolioId} people={people} duration={durations ? (durations[row.itemId] ?? null) : undefined} />))}
                </Fragment>
              ))}
              {count === 0 && (
                <tr>
                  <td colSpan={columns} className="px-3 py-6 text-center text-ink-muted">
                    No rows match. Change the filter or the search.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        </div>
      )}
    </section>
  );
}

const SORT_ORDER: PortfolioSort[] = ["manual", "status", "owner", "due", "name", "progress", "priority"].filter((key): key is PortfolioSort => (SORTS as readonly string[]).includes(key));
const GROUP_ORDER: PortfolioGroup[] = ["owner", "status", "priority", "kind"].filter((key): key is PortfolioGroup => (GROUPS as readonly string[]).includes(key));

// v1.73.0 (D-396, spec PORTFOLIOS §3.5 "Show options for <column> column"):
// each column's dropdown: Sort ascending, Sort descending, Group by this (where it groups).
function ColumnHead({ label, sorted, onSort, grouped, onGroup }: { label: string; sorted: "asc" | "desc" | null; onSort: (dir: "asc" | "desc") => void; grouped: boolean | null; onGroup: (() => void) | null }) {
  return (
    <th scope="col" aria-sort={sorted === "asc" ? "ascending" : sorted === "desc" ? "descending" : undefined} className="px-3 py-1.5 font-medium">
      <span className="inline-flex items-center gap-0.5">
        {label}
        <Menu
          label={`Show options for ${label} column`}
          title={`Options for ${label}`}
          trigger={<ChevronDown aria-hidden="true" className="h-3.5 w-3.5" />}
          buttonClass="grid h-6 w-6 place-items-center rounded text-ink-faint hover:bg-surface-muted hover:text-ink"
          align="left"
          menuClass="w-52"
          testId="column-menu"
          items={[
            { kind: "radio", close: true, label: "Sort ascending", icon: <ArrowUp className="h-4 w-4" />, checked: sorted === "asc", onSelect: () => onSort("asc") },
            { kind: "radio", close: true, label: "Sort descending", icon: <ArrowDown className="h-4 w-4" />, checked: sorted === "desc", onSelect: () => onSort("desc") },
            ...(onGroup ? [{ kind: "checkbox" as const, close: true, label: "Group by this column", checked: Boolean(grouped), onSelect: onGroup }] : []),
          ]}
        />
      </span>
    </th>
  );
}

// v1.73.0 (D-396, spec PORTFOLIOS §3.1 #9 / §3.5): each row's ⋯ menu: Open, Copy link, Remove from this portfolio.
function RowMenu({ portfolioId, itemId, name, href, canEdit }: { portfolioId: number; itemId: number; name: string; href: string | null; canEdit: boolean }) {
  const { call } = useWorkCall();
  const toast = useToast();
  const items: MenuItem[] = [
    ...(href
      ? [
          { label: "Open", icon: <ExternalLink className="h-4 w-4" />, href },
          { label: "Copy link", icon: <Link2 className="h-4 w-4" />, onSelect: () => void copyText(`${window.location.origin}${href}`).then((done) => toast(done ? { tone: "success", title: "Link copied." } : { tone: "error", title: `${COPY_BLOCKED} ${window.location.origin}${href}` })) },
        ]
      : []),
    ...(canEdit ? [...(href ? [{ kind: "separator" as const, label: "" }] : []), { label: "Remove from this portfolio", icon: <Trash2 className="h-4 w-4" />, tone: "danger" as const, onSelect: () => void call(() => removeWorkAction(portfolioId, itemId)), testId: "remove-work" }] : []),
  ];
  if (!items.length) return null;
  return <Menu label={`Actions for ${name}`} trigger={<MoreHorizontal aria-hidden="true" className="h-4 w-4" />} buttonClass="grid h-7 w-7 place-items-center rounded text-ink-muted hover:bg-surface-muted hover:text-ink" menuClass="w-56" testId="row-menu" items={items} />;
}

function MaskedLine({ row, columns, canEdit, portfolioId }: { row: Extract<PortfolioRow, { masked: true }>; columns: number; canEdit: boolean; portfolioId: number }) {
  const added = new Date(row.addedAt);
  return (
    <tr className="border-b border-line last:border-0" data-testid="portfolio-row" data-masked="true">
      <th scope="row" className="px-3 py-2 text-left font-normal">
        <span className="flex items-center gap-2 text-ink-muted">
          <Lock aria-hidden="true" className="h-4 w-4 shrink-0" />
          <span className="font-medium">{maskedName(row)}</span>
        </span>
      </th>
      <td colSpan={columns - 2} className="px-3 py-2 text-caption text-ink-muted">
        Added by {row.addedByName} on {formatDate(added)}. You don&apos;t have access: ask {row.addedByName} or the {row.kind === "PROJECT" ? "project" : "portfolio"}&apos;s owner for access.
      </td>
      <td className="px-3 py-2">
        <RowMenu portfolioId={portfolioId} itemId={row.itemId} name={maskedName(row)} href={null} canEdit={canEdit} />
      </td>
    </tr>
  );
}

// duration: undefined = the Duration column is off; null = no From/To on this row.
function Line({ row, fields, canEdit, portfolioId, people, duration }: { row: VisibleRow; fields: Field[]; canEdit: boolean; portfolioId: number; people: { id: number; label: string }[]; duration?: string | null }) {
  const { call, pending } = useWorkCall();
  const progress = progressOf(row.counts);
  const href = row.kind === "PROJECT" ? `/users/work/projects/${row.id}` : `/users/work/portfolios/${row.id}`;
  return (
    <tr className="border-b border-line last:border-0 hover:bg-surface-muted" data-testid="portfolio-row">
      <th scope="row" className="px-3 py-2 text-left font-normal">
        <span className="flex min-w-48 items-center gap-2">
          {row.kind === "PROJECT" ? <ProjectDot color={row.color} /> : <Briefcase aria-hidden="true" className="h-4 w-4 shrink-0 text-ink-muted" />}
          <Link href={href} className="font-medium text-ink hover:underline">
            {row.name}
          </Link>
          {row.kind === "PORTFOLIO" && <span className="text-caption text-ink-muted">Portfolio · {row.projects ?? 0} projects</span>}
          {row.archived && <span className="rounded bg-surface-muted px-1.5 text-caption text-ink-muted">Archived</span>}
        </span>
      </th>
      <td data-label="Status" className="px-3 py-2">
        <StatusPill status={row.status} />
      </td>
      <td data-label="Task progress" className="px-3 py-2">
        <ProgressMeter percent={progress.percent} text={progress.text} />
      </td>
      {duration === undefined ? (
        <td data-label="Due date" className="whitespace-nowrap px-3 py-2">{dayWords(row.dueOn)}</td>
      ) : (
        <>
          <td data-label="Dates" className="whitespace-nowrap px-3 py-2" data-testid="row-dates">
            {row.startOn || row.dueOn ? `${row.startOn ? `From ${dayWords(row.startOn)} ` : ""}${row.dueOn ? `To ${dayWords(row.dueOn)}` : ""}`.trim() : "—"}
          </td>
          <td data-label="Duration" className="whitespace-nowrap px-3 py-2 text-ink-muted" data-testid="row-duration">
            {duration ?? "—"}
          </td>
        </>
      )}
      <td data-label="Owner" className="whitespace-nowrap px-3 py-2">{row.ownerName}</td>
      <td data-label="Priority" className="px-3 py-2">
        {canEdit ? (
          <>
            <label className="sr-only" htmlFor={`prio-${row.itemId}`}>
              Priority of {row.name}
            </label>
            <select id={`prio-${row.itemId}`} value={row.priority ?? ""} disabled={pending} onChange={(event) => void call(() => priorityAction(portfolioId, row.itemId, event.target.value || null), { success: false })} className="field-input field-compact w-28 text-label" data-testid="priority-select">
              <option value="">—</option>
              {PRIORITIES.map((key) => (
                <option key={key} value={key}>
                  {PRIORITY_LABEL[key]}
                </option>
              ))}
            </select>
          </>
        ) : (
          (row.priority && PRIORITY_LABEL[row.priority]) || "—"
        )}
      </td>
      {fields.map((field) => (
        <td key={field.id} data-label={field.name} className="px-3 py-2">
          {canEdit ? <ValueEditor key={`${field.id}:${row.values[field.id] ?? ""}`} field={field} value={row.values[field.id] ?? ""} rowName={row.name} people={people} save={(value) => void call(() => portfolioValueAction(portfolioId, row.itemId, field.id, value), { success: false })} /> : <ValueText field={field} value={row.values[field.id] ?? ""} people={people} />}
        </td>
      ))}
      <td className="whitespace-nowrap px-3 py-2 text-caption">{row.counts.overdue > 0 && <span className="text-danger-600">{row.counts.overdue} overdue</span>}</td>
      <td className="px-3 py-2">
        <RowMenu portfolioId={portfolioId} itemId={row.itemId} name={row.name} href={href} canEdit={canEdit} />
      </td>
    </tr>
  );
}

function ValueText({ field, value, people }: { field: Field; value: string; people: { id: number; label: string }[] }) {
  if (!value) return <span className="text-ink-faint">—</span>;
  if (field.kind === "DATE") return <>{dayWords(value)}</>;
  if (field.kind === "PEOPLE") return <>{people.find((person) => String(person.id) === value)?.label ?? "Someone"}</>;
  return <>{value}</>;
}

function ValueEditor({ field, value, rowName, people, save }: { field: Field; value: string; rowName: string; people: { id: number; label: string }[]; save: (value: string | null) => void }) {
  const [draft, setDraft] = useState(value);
  const label = `${field.name} for ${rowName}`;
  if (field.kind === "SELECT")
    return (
      <select aria-label={label} value={value} onChange={(event) => save(event.target.value || null)} className="field-input field-compact w-32 text-label">
        <option value="">—</option>
        {field.options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    );
  if (field.kind === "PEOPLE")
    return (
      <div className="w-44">
        <PersonSelect ariaLabel={label} options={people} value={value ? Number(value) : null} onChange={(next) => save(next === null ? null : String(next))} emptyLabel="Nobody" compact floating />
      </div>
    );
  const commit = () => draft !== value && save(draft.trim() || null);
  return (
    <input
      aria-label={label}
      type={field.kind === "DATE" ? "date" : field.kind === "NUMBER" ? "number" : "text"}
      step={field.kind === "NUMBER" ? "any" : undefined}
      value={draft}
      maxLength={500}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") commit();
        if (event.key === "Escape") setDraft(value);
      }}
      className="field-input field-compact w-36 text-label"
    />
  );
}

// Add work (spec §3.8): a combobox over the projects and portfolios the
// person can see, in two groups; ↑/↓ move, Enter adds, Escape closes.
function AddWork({ portfolioId, choices, exclude }: { portfolioId: number; choices: { projects: { id: number; name: string; color: string }[]; portfolios: { id: number; name: string; color: string; items: number }[] }; exclude: Set<string> }) {
  const { call, pending } = useWorkCall();
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [active, setActive] = useState(0);
  const [live, setLive] = useState("");
  const words = text.trim().toLowerCase();
  const options: Choice[] = [
    ...choices.projects.filter((item) => item.id && !exclude.has(`project:${item.id}`) && (!words || item.name.toLowerCase().includes(words))).slice(0, 8).map((item) => ({ key: `project:${item.id}`, kind: "project" as const, id: item.id, name: item.name, color: item.color })),
    ...choices.portfolios
      .filter((item) => item.id !== portfolioId && !exclude.has(`portfolio:${item.id}`) && (!words || item.name.toLowerCase().includes(words)))
      .slice(0, 5)
      .map((item) => ({ key: `portfolio:${item.id}`, kind: "portfolio" as const, id: item.id, name: item.name, color: item.color, detail: `${item.items} items` })),
  ];
  const pick = (choice: Choice | undefined) => {
    if (!choice) return;
    void call(() => addWorkAction(portfolioId, choice.kind === "project" ? { projectId: choice.id } : { portfolioId: choice.id }), { success: false }).then((result) => {
      if (result?.ok) {
        setLive(`${choice.name} added.`);
        setText("");
        setActive(0);
        input.current?.focus();
      }
    });
  };
  const optionId = (index: number) => `${id}-o${index}`;
  return (
    <div className="relative w-full max-w-sm" data-testid="add-work">
      <label htmlFor={`${id}-input`} className="block text-caption text-ink-muted">
        <Plus aria-hidden="true" className="mr-0.5 inline h-3 w-3" /> Add work
      </label>
      <input
        ref={input}
        id={`${id}-input`}
        role="combobox"
        aria-expanded={open && options.length > 0}
        aria-controls={`${id}-list`}
        aria-autocomplete="list"
        aria-activedescendant={open && options[active] ? optionId(active) : undefined}
        value={text}
        disabled={pending}
        placeholder="Add a project or portfolio by name…"
        onChange={(event) => {
          setText(event.target.value);
          setOpen(true);
          setActive(0);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setOpen(true);
            setActive((value) => Math.min(value + 1, Math.max(options.length - 1, 0)));
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setActive((value) => Math.max(value - 1, 0));
          } else if (event.key === "Enter") {
            event.preventDefault();
            if (open) pick(options[active]);
          } else if (event.key === "Escape") setOpen(false);
        }}
        className="field-input field-compact text-label"
        data-testid="add-work-input"
      />
      {open && options.length > 0 && (
        <ul id={`${id}-list`} role="listbox" aria-label="Projects and portfolios" className="absolute left-0 right-0 z-popover mt-1 max-h-72 overflow-y-auto rounded-lg border border-line bg-raised p-1 shadow-overlay">
          {options.map((option, index) => (
            <Fragment key={option.key}>
              {(index === 0 || options[index - 1]!.kind !== option.kind) && (
                <li role="presentation" className="px-2 pb-0.5 pt-1.5 text-caption font-semibold text-ink-faint">
                  {option.kind === "project" ? "Projects" : "Portfolios"}
                </li>
              )}
              <li
                id={optionId(index)}
                role="option"
                aria-selected={index === active}
                onMouseDown={(event) => {
                  event.preventDefault();
                  pick(option);
                }}
                onMouseEnter={() => setActive(index)}
                className={`flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-label ${index === active ? "bg-primary-50 text-primary-700" : ""}`}
                data-testid="add-work-option"
              >
                {option.kind === "project" ? <ProjectDot color={option.color} /> : <Briefcase aria-hidden="true" className="h-3.5 w-3.5" />}
                <span className="truncate">{option.name}</span>
                {option.detail && <span className="ml-auto text-caption text-ink-muted">{option.detail}</span>}
              </li>
            </Fragment>
          ))}
        </ul>
      )}
      {open && text && options.length === 0 && <p className="absolute left-0 right-0 z-popover mt-1 rounded-lg border border-line bg-raised p-2 text-caption text-ink-muted shadow-overlay">Nothing you can see matches.</p>}
      <span role="status" aria-live="polite" className="sr-only">
        {live}
      </span>
    </div>
  );
}
