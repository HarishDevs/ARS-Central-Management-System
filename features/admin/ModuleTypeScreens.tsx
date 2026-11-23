import Link from "next/link";
import { notFound } from "next/navigation";
import { requireArea } from "@/server/authorization/guards";
import { EmptyState, PageHeader } from "@/features/shell/PageHeader";
import { Badge, Breadcrumbs } from "@/features/ui/Display";
import { Hint } from "@/features/ui/Hint";
import { ModuleTypeCommand, ModuleTypeEditor, NewModuleTypeForm } from "@/features/admin/ModuleTypeEditor";
import { DynamicFields } from "@/features/requests/DynamicFields";
import { findModuleType, listModuleTypes, listTypeVersions } from "@/lib/db/repositories/module-types.repository";
import { listAuditForEntity } from "@/lib/db/repositories/audit.repository";
import { listActiveUserOptions } from "@/lib/db/repositories/admin-users.repository";
import { listDepartments } from "@/lib/db/repositories/organisation.repository";
import { listGroups } from "@/lib/db/repositories/groups.repository";
import { loadFieldLookups } from "@/lib/db/repositories/lookups.repository";
import { MODULE_ADMIN_PATH, MODULE_LABEL, parseInfoSettings, parseTaskSettings, parseTicketSettings, type ModuleKind } from "@/server/modules/settings";
import { TicketFormSetup } from "@/features/tickets/TicketFormSetup";
import { ticketFormSetup } from "@/lib/db/repositories/tickets.repository";
import { indiaDateTimeText } from "@/server/modules/settings";
import { personLabel } from "@/lib/people/label";
import { ListToolbar } from "@/features/ui/ListToolbar";
import { ListViews } from "@/features/lists/ListViews";
import { FoldScope } from "@/features/ui/GroupFold";
import { SortHead } from "@/features/admin/SortHead";
import { GroupedRows } from "@/features/admin/GroupedRows";
import { applyDefaultListView } from "@/server/lists/views";
import { parseColumnSort, sortRows } from "@/server/lists/sorting";
import { groupRows, pickGroup } from "@/server/lists/group-rows";
import { groupMenu } from "@/server/admin/lists";

// v1.58.0 (D-354, owner): the types list: every column sorts both ways, Group
// by Status, Live version or Draft (folded at first), saved views
// (list_admin_task_types, list_admin_information_types, list_admin_ticket_forms).
// A type's Versions table sorts too (no group or views: one type's few versions).
const TYPE_COLUMNS = ["name", "code", "live", "draft", "records", "status"] as const;
const TYPE_GROUPS = [
  { key: "status", label: "Status" },
  { key: "live", label: "Live version" },
  { key: "draft", label: "Draft" },
] as const;
const VERSION_COLUMNS = ["version", "status", "fields", "published"] as const;
type Query = Record<string, string | undefined>;

// v1.9.0 (D-144): Admin → Task types / Information types. Server screens
// shared by both modules; every page checks the admin area itself.
const PLURAL: Record<ModuleKind, string> = { TASK: "Task types", INFO: "Information types", TICKET: "Ticket forms" };
const ACTION_TEXT: Record<string, string> = {
  MODULE_TYPE_CREATED: "Created",
  MODULE_TYPE_DRAFT_SAVED: "Draft saved",
  MODULE_TYPE_DRAFT_STARTED: "New draft started",
  MODULE_TYPE_DRAFT_DISCARDED: "Draft discarded",
  MODULE_TYPE_PUBLISHED: "Published",
  MODULE_TYPE_RETIRED: "Retired",
  MODULE_TYPE_REACTIVATED: "Reactivated",
};

export async function ModuleTypesListScreen({ module, searchParams = {} }: { module: ModuleKind; searchParams?: Query }) {
  const { user } = await requireArea("admin");
  const base = MODULE_ADMIN_PATH[module];
  const target = `list_admin_${base.split("/").pop()!.replace(/-/g, "_")}`;
  await applyDefaultListView(user.id, target, base, searchParams);
  const loaded = await listModuleTypes(module);
  const sort = parseColumnSort(searchParams, TYPE_COLUMNS);
  const group = pickGroup(searchParams.group, TYPE_GROUPS.map((choice) => choice.key));
  const types = sort.sortBy
    ? sortRows(loaded, (type) => (sort.sortBy === "name" ? type.name : sort.sortBy === "code" ? type.code : sort.sortBy === "live" ? type.liveVersion : sort.sortBy === "draft" ? type.hasDraft : sort.sortBy === "records" ? type.records : type.active), sort.dir)
    : loaded;
  const groups = group
    ? groupRows(types, (type): [string, number] => (group === "status" ? (type.active ? ["Active", 0] : ["Retired", 1]) : group === "live" ? (type.liveVersion ? ["Live", 0] : ["Not published", 1]) : type.hasDraft ? ["Has a draft", 0] : ["No draft", 1]))
    : null;
  return (
    <>
      <PageHeader
        title={PLURAL[module]}
        description={
          module === "TASK"
            ? "The kinds of task people can create: the form, who may create them, whom they can be assigned to and how they are completed."
            : module === "TICKET"
              ? "The forms people raise tickets with (one per request type): the form, its category, its coordinators (any one of them assigns the ticket) and who may raise it."
              : "The kinds of information people can send: the form, who may send them, to whom, acknowledgement and expiry."
        }
      />
      <section className="mb-8" aria-labelledby="new-type">
        <h2 id="new-type" className="mb-2 font-semibold">
          New {MODULE_LABEL[module].toLowerCase()} type
        </h2>
        <NewModuleTypeForm module={module} />
      </section>
      {types.length > 0 && (
        <>
          <ListToolbar id="module-types-view" path={base} label={`${PLURAL[module]} view`} keep={{}} filterCount={0} clearHref={null} group={groupMenu(base, searchParams, TYPE_GROUPS, group)} />
          <ListViews userId={user.id} target={target} path={base} query={searchParams} />
        </>
      )}
      {types.length === 0 ? (
        <EmptyState title={`No ${PLURAL[module].toLowerCase()} yet`} body="Create the first one above, then set up its form and publish it." />
      ) : (
        <FoldScope enabled={Boolean(group)}>
        <div className="card overflow-x-auto">
          <table className="data-table" data-testid="module-types">
            <SortHead
              path={base}
              query={searchParams}
              sort={sort}
              columns={[
                { key: "name", label: "Name" },
                { key: "code", label: "Code" },
                { key: "live", label: "Live version" },
                { key: "draft", label: "Draft" },
                { key: "records", label: "Records" },
                { key: "status", label: "Status" },
              ]}
            />
            <GroupedRows
              rows={types}
              groups={groups}
              colSpan={6}
              paged={false}
              render={(type) => (
                <tr key={type.id}>
                  <td>
                    <Link href={`${base}/${type.id}`} className="link font-medium">
                      {type.name}
                    </Link>
                    {type.description && <p className="text-caption text-ink-muted">{type.description}</p>}
                  </td>
                  <td className="font-mono text-label">{type.code}</td>
                  <td>{type.liveVersion ? `v${type.liveVersion}` : <span className="text-ink-faint">Not published</span>}</td>
                  <td>{type.hasDraft ? <Badge tone="warning">Draft</Badge> : "—"}</td>
                  <td className="tabular-nums">{type.records}</td>
                  <td>{type.active ? <Badge tone="success">Active</Badge> : <Badge>Retired</Badge>}</td>
                </tr>
              )}
            />
          </table>
        </div>
        </FoldScope>
      )}
    </>
  );
}

export async function ModuleTypeDetailScreen({ module, id, view, searchParams = {} }: { module: ModuleKind; id: string; view?: string; searchParams?: Query }) {
  await requireArea("admin");
  if (!/^\d{1,10}$/.test(id)) notFound();
  const type = await findModuleType(Number(id));
  if (!type || type.module !== module) notFound();
  const [versions, history, people, departments, groups, lookups] = await Promise.all([
    listTypeVersions(type.id),
    listAuditForEntity([module === "TASK" ? "TASK_TYPE" : module === "TICKET" ? "TICKET_FORM" : "INFO_TYPE"], type.id, 50),
    listActiveUserOptions(),
    listDepartments(),
    listGroups(),
    loadFieldLookups(),
  ]);
  const draft = versions.find((version) => version.status === "DRAFT") ?? null;
  const live = versions.find((version) => version.status === "PUBLISHED") ?? null;
  const viewed = view && /^\d+$/.test(view) ? (versions.find((version) => version.versionNo === Number(view)) ?? null) : null;
  const base = MODULE_ADMIN_PATH[module];
  const versionSort = parseColumnSort(searchParams, VERSION_COLUMNS);
  const sortedVersions = versionSort.sortBy
    ? sortRows(versions, (version) => (versionSort.sortBy === "version" ? version.versionNo : versionSort.sortBy === "status" ? version.status : versionSort.sortBy === "fields" ? version.form.length : version.publishedAt), versionSort.dir)
    : versions;
  const personOptions = people.map((person) => ({ id: person.id, label: personLabel(person), detail: person.departmentName ?? undefined }));
  const parse = module === "TASK" ? parseTaskSettings : module === "TICKET" ? parseTicketSettings : parseInfoSettings;
  // v1.55.0 (D-327): a ticket form's category and coordinators (kept with the form, not a version).
  const ticketSetup = module === "TICKET" ? await ticketFormSetup(type.id) : null;

  return (
    <>
      <Breadcrumbs items={[{ href: "/admin", label: "Admin" }, { href: base, label: PLURAL[module] }, { label: type.name }]} />
      <PageHeader title={type.name} meta={`${MODULE_LABEL[module]} type ${type.code}. ${live ? `Version ${live.versionNo} is live.` : "Not published yet: nobody can create these until it is."}`}>
        {type.active ? <Badge tone="success">Active</Badge> : <Badge>Retired</Badge>}
      </PageHeader>

      <div className="mb-6 flex flex-wrap items-start gap-3" aria-label="Type commands">
        {draft && (
          <ModuleTypeCommand
            module={module}
            typeId={type.id}
            command="publish"
            variant="primary"
            label={`Publish version ${draft.versionNo}`}
            confirmTitle={`Publish version ${draft.versionNo}?`}
            confirm="New records will use this version. Records already made keep the version they were made with."
          />
        )}
        {!draft && (
          <div className="flex items-start gap-1.5">
            <ModuleTypeCommand module={module} typeId={type.id} command="new-draft" label="Edit as a new draft" />
            <Hint text="The live version can't be changed in place. Edit it as a new draft, then publish the draft." align="start" className="mt-2" />
          </div>
        )}
        {draft && live && <ModuleTypeCommand module={module} typeId={type.id} command="discard" label="Discard draft" tone="danger" confirmTitle="Discard the draft?" confirm="Your unpublished changes are removed. The live version stays as it is." />}
        {type.active ? (
          <ModuleTypeCommand module={module} typeId={type.id} command="retire" label="Retire type" tone="danger" confirmTitle={`Retire ${type.name}?`} confirm="Nobody can create new records of this type. Existing records stay open and can be finished." />
        ) : (
          <ModuleTypeCommand module={module} typeId={type.id} command="reactivate" label="Reactivate type" />
        )}
      </div>

      {ticketSetup && <TicketFormSetup typeId={type.id} setup={ticketSetup} people={personOptions} />}

      {draft && (
        <section aria-labelledby="draft-heading" className="mb-10">
          <h2 id="draft-heading" className="mb-3 text-section font-semibold">
            Draft version {draft.versionNo}
          </h2>
          <ModuleTypeEditor
            module={module}
            typeId={type.id}
            initialName={type.name}
            initialDescription={type.description ?? ""}
            initialForm={draft.form}
            initialSettings={parse(draft.settings)}
            lookups={lookups}
            people={personOptions}
            departments={departments.filter((department) => department.active).map((department) => ({ id: department.id, label: department.name }))}
            groups={groups.filter((group) => group.active).map((group) => ({ id: group.id, label: group.name }))}
          />
        </section>
      )}

      <section aria-labelledby="versions-heading" className="mb-10">
        <h2 id="versions-heading" className="mb-3 text-section font-semibold">
          Versions
        </h2>
        <div className="card overflow-x-auto">
          <table className="data-table" data-testid="type-versions">
            <SortHead
              path={`${base}/${type.id}`}
              query={searchParams}
              sort={versionSort}
              columns={[
                { key: "version", label: "Version" },
                { key: "status", label: "Status" },
                { key: "fields", label: "Fields" },
                { key: "published", label: "Published" },
                { label: "Form", srOnly: true },
              ]}
            />
            <tbody>
              {sortedVersions.map((version) => (
                <tr key={version.id}>
                  <td>v{version.versionNo}</td>
                  <td>{version.status === "PUBLISHED" ? <Badge tone="success">Live</Badge> : version.status === "DRAFT" ? <Badge tone="warning">Draft</Badge> : <Badge>Earlier</Badge>}</td>
                  <td>{version.form.length}</td>
                  <td className="text-label">{version.publishedAt ? `${indiaDateTimeText(version.publishedAt)}${version.publishedByName ? ` by ${version.publishedByName}` : ""}` : "—"}</td>
                  <td>
                    <Link href={`${base}/${type.id}?view=${version.versionNo}#view`} className="link text-label">
                      View form
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {viewed && (
          <div id="view" className="mt-4 rounded-lg border-2 border-dashed border-line p-4">
            <h3 className="mb-3 font-semibold">Form of version {viewed.versionNo} (read only)</h3>
            <div className="card px-5 py-5">
              {viewed.form.length === 0 ? <p className="text-label text-ink-muted">No extra fields.</p> : <DynamicFields fields={viewed.form} mode="submit" people={personOptions} lookups={lookups} result={null} />}
            </div>
          </div>
        )}
      </section>

      <section aria-labelledby="history-heading">
        <h2 id="history-heading" className="mb-3 text-section font-semibold">
          Change history
        </h2>
        {history.length === 0 ? (
          <p className="text-label text-ink-muted">No changes recorded yet.</p>
        ) : (
          <ol className="card divide-y divide-line" data-testid="type-history">
            {history.map((entry) => (
              <li key={entry.id} className="px-5 py-3 text-label">
                <span className="font-medium">{ACTION_TEXT[entry.action] ?? entry.action}</span>
                <span className="text-ink-muted">
                  {" "}
                  · {indiaDateTimeText(entry.occurredAt)}
                  {entry.actorName ? ` · ${entry.actorName}` : ""}
                </span>
                <HistoryDetail metadata={entry.metadata} />
              </li>
            ))}
          </ol>
        )}
      </section>
    </>
  );
}

// What changed, in words (fields added or removed, the version).
function HistoryDetail({ metadata }: { metadata: unknown }) {
  const data = (typeof metadata === "string" ? JSON.parse(metadata) : metadata) as Record<string, unknown> | null;
  if (!data) return null;
  const parts: string[] = [];
  if (typeof data.version === "number") parts.push(`version ${data.version}`);
  const before = Array.isArray(data.fieldsBefore) ? (data.fieldsBefore as string[]) : null;
  const after = Array.isArray(data.fieldsAfter) ? (data.fieldsAfter as string[]) : null;
  if (before && after) {
    const added = after.filter((item) => !before.includes(item));
    const removed = before.filter((item) => !after.includes(item));
    if (added.length) parts.push(`fields added: ${added.join(", ")}`);
    if (removed.length) parts.push(`fields removed: ${removed.join(", ")}`);
    if (JSON.stringify(data.settingsBefore) !== JSON.stringify(data.settingsAfter)) parts.push("options changed");
  }
  if (typeof data.replaced === "number") parts.push(`replaced version ${data.replaced}`);
  return parts.length ? <p className="mt-0.5 text-caption text-ink-muted">{parts.join("; ")}</p> : null;
}
