import { featureOn } from "@/server/settings/features";
import { ListChecks } from "lucide-react";
import { notFound } from "next/navigation";
import Link from "next/link";
import { requireArea } from "@/server/authorization/guards";
import { EmptyState, PageHeader } from "@/features/shell/PageHeader";
import { Badge, type Tone } from "@/features/ui/Display";
import { countTasks, hasDirectReports, listTasks } from "@/lib/db/repositories/tasks.repository";
import { listModuleTypes, listTypeVersions } from "@/lib/db/repositories/module-types.repository";
import { listActiveUserOptions } from "@/lib/db/repositories/admin-users.repository";
import { parseTaskFilters, PAGE_SIZES, TASK_SORT_LABEL, TASK_SORTS, TASK_TAB_LABEL, TASK_TABS, taskListSql, taskQuery, type TaskBase } from "@/server/modules/task-lists";
import { isOverdue, TASK_STATUS_LABEL, TASK_STATUSES, type TaskStatus } from "@/server/modules/task-rules";
import { indiaDateTimeText, PRIORITY_LABEL, TASK_PRIORITIES, type TaskPriority } from "@/server/modules/settings";
import { displayValue, NUMERIC_TYPES, OPTION_TYPES, type FormField } from "@/server/forms/fields";
import { ChoicePills, TaskPriorityPill } from "@/features/ui/ChoicePill";
import { choiceValues } from "@/features/modules/RecordParts";
import { isAdminActor } from "@/server/modules/tasks";
import { TaskCheck } from "@/features/work/client";
import { teamOf } from "@/server/work/task-access";
import { ListToolbar } from "@/features/ui/ListToolbar";
import { FoldScope, FoldTbody } from "@/features/ui/GroupFold";
import { SortTh } from "@/features/ui/SortTh";
import { ListViews } from "@/features/lists/ListViews";
import { applyDefaultListView } from "@/server/lists/views";
import { nextDir } from "@/server/lists/sorting";
import { departmentBucket, dueBucket, groupRows, indiaDayOf } from "@/server/lists/group-rows";
import { TASK_LIST_GROUPS, type TaskListGroup } from "@/server/modules/task-lists";
import type { TaskListItem } from "@/lib/db/repositories/tasks.repository";
import { PersonSelect } from "@/features/ui/PersonSelect";
import { personLabel } from "@/lib/people/label";
import { NoResults } from "@/features/ui/Display";
import { periodicDetails, visibleTaskClause } from "@/lib/db/repositories/work.repository";
import { workViewer } from "@/server/work/task-access";
import { parseRecurrence, recurrenceLabel } from "@/server/work/more-rules";
import { StopRepeatButton } from "@/features/work/MoreParts";

// v1.9.0 (D-143): My tasks / Assigned by me / Team tasks. Filters live in
// the address (GET form), so a list can be bookmarked and shared.
const TITLE: Record<TaskBase, string> = { MINE: "Assigned to me", CREATED: "Assigned by me", TEAM: "Team tasks", PERIODIC: "Periodic tasks" }; // v1.54.3 (owner)
const PATH: Record<TaskBase, string> = { MINE: "/users/tasks", CREATED: "/users/tasks/assigned", TEAM: "/users/tasks/team", PERIODIC: "/users/work/periodic" };
const DESCRIPTION: Record<TaskBase, string> = {
  MINE: "Ad hoc tasks assigned to you. Repeating ones are on Periodic tasks.",
  CREATED: "Ad hoc tasks you created or assigned to someone. Repeating ones are on Periodic tasks.",
  PERIODIC: "Tasks that repeat. When one is completed the next one is made. Make any task periodic from its Repeats box.",
  TEAM: "Tasks of everyone below you in the reporting line, at every level (IT sees everyone's).",
};
// v1.58.0 (D-353, owner: "all the changes like filters, group, sort can be saved
// as a view ... along with names"; views are the person's own).
const VIEW_TARGET: Record<TaskBase, string> = { MINE: "list_tasks_mine", CREATED: "list_tasks_created", TEAM: "list_tasks_team", PERIODIC: "list_tasks_periodic" };
// v1.58.0 (D-354): listed fields whose stored value is a list, a file or a
// person/record id: their column can't be sorted in a meaningful order.
const UNSORTABLE_FIELD_TYPES: readonly string[] = ["LINE_ITEMS", "ITEM_LIST", "ATTACHMENT", "PERSON", "LOOKUP", "SECTION"];
export const STATUS_TONE: Record<TaskStatus, Tone> = { OPEN: "info", IN_PROGRESS: "primary", BLOCKED: "warning", COMPLETED: "success", CANCELLED: "neutral" };
export const PRIORITY_TONE: Record<TaskPriority, Tone> = { LOW: "neutral", NORMAL: "neutral", ELEVATED: "info", IMPORTANT: "warning", HIGH: "warning", URGENT: "danger" };

export async function TaskListScreen({ base, query }: { base: TaskBase; query: Record<string, string | string[] | undefined> }) {
  const { user } = await requireArea("users");
  if (!(await featureOn("tasks", user))) notFound();
  // v1.58.0 (D-353): opening the list with nothing in the address shows the person's default view.
  await applyDefaultListView(user.id, VIEW_TARGET[base], PATH[base], query);
  const filters = parseTaskFilters(query);
  // D-216: Team tasks covers the whole reporting line below the person.
  const viewer = { id: user.id, isAdmin: isAdminActor(user), teamIds: base === "TEAM" && !isAdminActor(user) ? await teamOf(user.id) : undefined };
  const now = new Date();
  const [types, people, manages] = await Promise.all([listModuleTypes("TASK"), listActiveUserOptions(), base === "TEAM" && !viewer.isAdmin ? hasDirectReports(user.id) : Promise.resolve(true)]);
  // Fields marked "searchable" in any version, and the chosen type's listed columns.
  const versions = (await Promise.all(types.map((type) => listTypeVersions(type.id)))).flat();
  const searchable = [...new Set(versions.flatMap((version) => version.form.filter((field) => field.searchable).map((field) => field.key)))];
  const chosen = filters.typeId ? versions.find((version) => version.typeId === filters.typeId && version.status === "PUBLISHED") : undefined;
  const columns: FormField[] = chosen ? chosen.form.filter((field) => field.listed && field.type !== "SECTION").slice(0, 4) : [];
  // v1.58.0 (D-354): a field column sorts only while that field is on screen.
  const sortableFields = columns.filter((field) => !UNSORTABLE_FIELD_TYPES.includes(field.type));
  if (filters.sortBy?.startsWith("f_") && !sortableFields.some((field) => `f_${field.key}` === filters.sortBy)) filters.sortBy = null;
  if ((filters.sortBy === "repeats" || filters.sortBy === "done") && base !== "PERIODIC") filters.sortBy = null;
  const numericKeys = sortableFields.filter((field) => NUMERIC_TYPES.includes(field.type)).map((field) => field.key);

  // v1.54.7 (owner): Periodic tasks uses this list too (tabs, Filter, Sort, Options).
  const visible = base === "PERIODIC" ? visibleTaskClause(await workViewer(user)) : undefined;
  const sql = taskListSql(filters, base, viewer, searchable, now, undefined, visible, numericKeys);
  const [list, counts] = await Promise.all([
    listTasks(sql.where, sql.params, sql.orderBy, filters.size, (filters.page - 1) * filters.size),
    Promise.all(
      TASK_TABS.map(async (tab) => {
        const counted = taskListSql(filters, base, viewer, searchable, now, tab, visible);
        return [tab, await countTasks(counted.where, counted.params)] as const;
      }),
    ),
  ]);
  const repeats = base === "PERIODIC" ? await periodicDetails(list.rows.map((task) => task.id)) : null;
  // v1.57.5 (D-344, owner: "add group by option for all the pages where table is available").
  const fromSide = base === "MINE";
  const groupLabel: Record<TaskListGroup, string> = { dept: fromSide ? "Department (who gave it)" : "Department", person: fromSide ? "From" : "Assignee", type: "Type", priority: "Priority", status: "Status", due: "Due date" };
  const PRIORITY_ORDER: Record<string, number> = { URGENT: 0, HIGH: 1, IMPORTANT: 2, ELEVATED: 3, NORMAL: 4, LOW: 5 };
  const STATUS_ORDER: Record<string, number> = { OPEN: 0, IN_PROGRESS: 1, BLOCKED: 2, COMPLETED: 3, CANCELLED: 4 };
  const todayDay = indiaDayOf(now);
  const bucket = (task: TaskListItem): [string, number] => {
    switch (filters.group) {
      case "dept":
        return departmentBucket(fromSide ? task.createdByDepartment : task.assigneeDepartment);
      case "person":
        return [fromSide ? task.createdByName : task.assigneeName, 0];
      case "type":
        return [task.typeName, 0];
      case "priority":
        return [PRIORITY_LABEL[task.priority] ?? task.priority, PRIORITY_ORDER[task.priority] ?? 9];
      case "status":
        return [TASK_STATUS_LABEL[task.status], STATUS_ORDER[task.status] ?? 9];
      default:
        return dueBucket(task.dueAt ? indiaDayOf(task.dueAt) : null, todayDay, task.status !== "COMPLETED" && task.status !== "CANCELLED");
    }
  };
  const groups = filters.group ? groupRows(list.rows, bucket) : [{ key: "all", label: "", items: list.rows }];
  const pages = Math.max(1, Math.ceil(list.total / filters.size));
  const names = new Map(people.map((person) => [person.id, person.name]));
  const path = PATH[base];
  // v1.58.0 (D-354, owner: "sorting in all the tables asc to desc or vice versa
  // in all columns"): each column title sorts the whole list (every page).
  const current = { sortBy: filters.sortBy ?? null, dir: filters.dir ?? "asc" };
  const sortLink = (column: string) => `${path}${taskQuery(filters, { sortBy: column, dir: nextDir(current, column) })}`;
  const sortTh = (column: string, label: string) => <SortTh key={column} label={label} column={column} sortBy={current.sortBy} dir={current.dir} href={sortLink(column)} />;
  const columnLabel: Record<string, string> = {
    task: "Task",
    type: "Type",
    person: base === "MINE" ? "From" : "Assignee",
    priority: "Priority",
    status: "Status",
    due: "Due",
    repeats: "Repeats",
    done: "Done so far",
    ...Object.fromEntries(columns.map((field) => [`f_${field.key}`, field.label])),
  };

  return (
    <>
      <PageHeader title={TITLE[base]} description={DESCRIPTION[base]} icon={ListChecks}>
        <Link href="/users/tasks/new" className="btn-primary btn-compact">
          New task
        </Link>
      </PageHeader>
      {base === "TEAM" && !manages ? (
        <EmptyState title="Nobody reports to you" body="Team tasks shows the tasks of people whose reporting manager you are." />
      ) : (
        <>
          <nav aria-label="Quick filters" className="mb-3 flex flex-wrap gap-x-1 border-b border-line">
            {counts.map(([tab, count]) => (
              <Link
                key={tab}
                href={`${path}${taskQuery(filters, { tab })}`}
                aria-current={filters.tab === tab ? "page" : undefined}
                className={`-mb-px border-b-2 px-2.5 py-1.5 text-label ${filters.tab === tab ? "border-primary-600 font-semibold text-primary-700" : "border-transparent text-ink-muted hover:text-ink"}`}
              >
                {TASK_TAB_LABEL[tab]} ({count})
              </Link>
            ))}
          </nav>
          <ListToolbar
            id="task-filters"
            path={path}
            label="Filter tasks"
            keep={{
              tab: filters.tab !== "open" ? filters.tab : undefined,
              sort: filters.sort !== "due" ? filters.sort : undefined,
              size: filters.size !== 25 ? String(filters.size) : undefined,
              group: filters.group ?? undefined,
              sortBy: filters.sortBy ?? undefined, // v1.58.0 (D-354): a column sort stays when filtering
              dir: filters.sortBy ? filters.dir : undefined,
            }}
            search={{ name: "q", value: filters.q, placeholder: "Number, title or description" }}
            filterCount={[filters.typeId, filters.priorities.length, filters.statuses.length, filters.personId, filters.dueFrom || filters.dueTo, filters.createdFrom || filters.createdTo].filter(Boolean).length}
            clearHref={
              filters.q || filters.typeId || filters.priorities.length || filters.statuses.length || filters.personId || filters.dueFrom || filters.dueTo || filters.createdFrom || filters.createdTo
                ? `${path}${taskQuery({ ...filters, q: "", typeId: null, priorities: [], statuses: [], personId: null, dueFrom: null, dueTo: null, createdFrom: null, createdTo: null })}`
                : null
            }
            filters={
              <>
                <label className="text-label">
                  Type
                  <select name="type" defaultValue={filters.typeId ?? ""} className="field-input h-10">
                    <option value="">Any</option>
                    {types.map((type) => (
                      <option key={type.id} value={type.id}>
                        {type.name}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="text-label">
                  <label htmlFor="task-person">{base === "MINE" ? "Created by" : "Assigned to"}</label>
                  <PersonSelect
                    id="task-person"
                    name="person"
                    options={people.map((person) => ({ id: person.id, label: personLabel(person), detail: person.departmentName ?? undefined }))}
                    defaultValue={filters.personId ?? null}
                    emptyLabel="Anyone"
                    compact
                  />
                </div>
                <label className="text-label">
                  Priority
                  <select name="priority" defaultValue={filters.priorities[0] ?? ""} className="field-input h-10">
                    <option value="">Any</option>
                    {TASK_PRIORITIES.map((priority) => (
                      <option key={priority} value={priority}>
                        {PRIORITY_LABEL[priority]}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-label">
                  Status
                  <select name="status" defaultValue={filters.statuses[0] ?? ""} className="field-input h-10">
                    <option value="">Any</option>
                    {TASK_STATUSES.map((status) => (
                      <option key={status} value={status}>
                        {TASK_STATUS_LABEL[status]}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-label">
                  Due from
                  <input type="date" name="dueFrom" defaultValue={filters.dueFrom ?? ""} className="field-input h-10" />
                </label>
                <label className="text-label">
                  Due to
                  <input type="date" name="dueTo" defaultValue={filters.dueTo ?? ""} className="field-input h-10" />
                </label>
                <label className="text-label">
                  Created from
                  <input type="date" name="createdFrom" defaultValue={filters.createdFrom ?? ""} className="field-input h-10" />
                </label>
                <label className="text-label">
                  Created to
                  <input type="date" name="createdTo" defaultValue={filters.createdTo ?? ""} className="field-input h-10" />
                </label>
              </>
            }
            sort={{
              // v1.58.0 (D-354): a column title's sort shows here too; a menu choice replaces it.
              label: filters.sortBy ? `${columnLabel[filters.sortBy] ?? "Column"} (${filters.dir === "desc" ? "descending" : "ascending"})` : TASK_SORT_LABEL[filters.sort],
              changed: filters.sort !== "due" || Boolean(filters.sortBy),
              choices: TASK_SORTS.map((sort) => ({ label: TASK_SORT_LABEL[sort], href: `${path}${taskQuery(filters, { sort, sortBy: null })}`, active: !filters.sortBy && filters.sort === sort })),
              clearHref: filters.sort !== "due" || filters.sortBy ? `${path}${taskQuery(filters, { sort: "due", sortBy: null })}` : undefined,
            }}
            group={{
              label: filters.group ? groupLabel[filters.group] : null,
              clearHref: `${path}${taskQuery(filters, { group: null })}`,
              choices: TASK_LIST_GROUPS.map((group) => ({ label: groupLabel[group], href: `${path}${taskQuery(filters, { group })}`, active: filters.group === group })),
            }}
            sizes={PAGE_SIZES.map((size) => ({ label: `${size} per page`, href: `${path}${taskQuery(filters, { size })}`, active: filters.size === size }))}
          />
          <ListViews userId={user.id} target={VIEW_TARGET[base]} path={path} query={Object.fromEntries(new URLSearchParams(taskQuery(filters)).entries())} />
          {list.rows.length === 0 ? (
            filters.q || filters.typeId || filters.priorities.length || filters.statuses.length || filters.personId || filters.dueFrom || filters.dueTo || filters.createdFrom || filters.createdTo ? (
              <NoResults what="tasks" query={filters.q} clearSearchHref={`${path}${taskQuery(filters, { q: "" })}`} resetHref={`${path}${taskQuery({ ...filters, q: "", typeId: null, priorities: [], statuses: [], personId: null, dueFrom: null, dueTo: null, createdFrom: null, createdTo: null })}`} />
            ) : (
              <EmptyState title="No tasks here" body={filters.tab === "open" ? "Nothing open here. Try another tab." : "Nothing in this tab. Try another tab."} />
            )
          ) : (
            // v1.58.0 (D-352): groups start folded; Expand all / Collapse all above them.
            <FoldScope enabled={Boolean(filters.group)}>
            <div className="card overflow-x-auto">
              <table className="data-table" data-testid={base === "PERIODIC" ? "periodic-table" : "task-table"}>
                <caption className="sr-only">{TITLE[base]}</caption>
                <thead>
                  <tr>
                    <th scope="col">
                      <span className="sr-only">Done</span>
                    </th>
                    {sortTh("task", columnLabel.task!)}
                    {sortTh("type", columnLabel.type!)}
                    {sortTh("person", columnLabel.person!)}
                    {sortTh("priority", columnLabel.priority!)}
                    {sortTh("status", columnLabel.status!)}
                    {sortTh("due", columnLabel.due!)}
                    {repeats && (
                      <>
                        {sortTh("repeats", columnLabel.repeats!)}
                        {sortTh("done", columnLabel.done!)}
                        <th scope="col">
                          <span className="sr-only">Stop</span>
                        </th>
                      </>
                    )}
                    {columns.map((field) =>
                      sortableFields.includes(field) ? (
                        sortTh(`f_${field.key}`, field.label)
                      ) : (
                        <th key={field.key} scope="col" title="This column holds a list, a file or a person, so it can't be sorted.">
                          {field.label}
                        </th>
                      ),
                    )}
                  </tr>
                </thead>
                {groups.map((group) => {
                  const rows = group.items.map((task) => {
                    const late = isOverdue(task, now);
                    return (
                      <tr key={task.id}>
                        <td className="w-8">
                          {/* D-219: tick to complete, as everywhere (only the assignee here). */}
                          <TaskCheck taskId={task.id} done={task.status === "COMPLETED"} disabled={task.assigneeId !== user.id || task.status === "CANCELLED"} label={task.title} />
                        </td>
                        <td>
                          <Link href={`/users/tasks/${task.id}`} className="link font-medium">
                            {task.title}
                          </Link>
                          <p className="font-mono text-caption text-ink-muted">{task.taskNo}</p>
                        </td>
                        <td className="text-label">{task.typeName}</td>
                        <td className="text-label">{base === "MINE" ? task.createdByName : task.assigneeName}</td>
                        <td>
                          <TaskPriorityPill priority={task.priority} showNormal /> {/* v1.47.0: the one priority pill */}
                        </td>
                        <td>
                          <Badge tone={STATUS_TONE[task.status]}>{TASK_STATUS_LABEL[task.status]}</Badge>
                        </td>
                        <td className={`text-label ${late ? "font-semibold text-danger-600" : ""}`}>
                          {task.dueAt ? indiaDateTimeText(task.dueAt) : "—"}
                          {late && <span className="block text-caption">Overdue</span>}
                        </td>
                        {repeats && (
                          <>
                            <td className="text-label">{(() => {
                              const rule = parseRecurrence(repeats.get(task.id)?.rule);
                              return rule ? recurrenceLabel(rule) : "Stopped";
                            })()}</td>
                            <td className="text-label">{repeats.get(task.id)?.doneInSeries ?? 0}</td>
                            <td>{task.status !== "COMPLETED" && task.status !== "CANCELLED" && <StopRepeatButton taskId={task.id} />}</td>
                          </>
                        )}
                        {columns.map((field) => (
                          <td key={field.key} className="text-label">
                            {/* v1.47.0: coloured choice values. */}
                            {OPTION_TYPES.includes(field.type) && field.optionColors ? <ChoicePills values={choiceValues(field, task.formData[field.key])} /> : displayValue(field, task.formData[field.key], names)}
                          </td>
                        ))}
                      </tr>
                    );
                  });
                  return group.label ? (
                    <FoldTbody key={group.key} label={group.label} count={group.items.length} colSpan={7 + (repeats ? 3 : 0) + columns.length}>
                      {rows}
                    </FoldTbody>
                  ) : (
                    <tbody key={group.key}>{rows}</tbody>
                  );
                })}
              </table>
            </div>
            </FoldScope>
          )}
          {pages > 1 && (
            <nav aria-label="Pages" className="mt-4 flex items-center justify-between text-label">
              {filters.page > 1 ? (
                <Link href={`${path}${taskQuery(filters, { page: filters.page - 1 })}`} className="link">
                  ← Previous
                </Link>
              ) : (
                <span />
              )}
              <span className="text-ink-muted">
                Page {filters.page} of {pages} · {list.total} tasks
              </span>
              {filters.page < pages ? (
                <Link href={`${path}${taskQuery(filters, { page: filters.page + 1 })}`} className="link">
                  Next →
                </Link>
              ) : (
                <span />
              )}
            </nav>
          )}
        </>
      )}
    </>
  );
}
