import { Plus } from "lucide-react";
import { Email } from "@/features/ui/SafeText";
import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/features/shell/PageHeader";
import { DataTable } from "@/features/ui/DataTable";
import { Badge } from "@/features/ui/Display";
import { requireArea } from "@/server/authorization/guards";
import { listUsersForAdmin } from "@/lib/db/repositories/admin-users.repository";
import { listDepartments } from "@/lib/db/repositories/organisation.repository";
import { checkCanEdit } from "@/server/admin/user-rules";
import { UserRowMenu } from "@/features/admin/UserRowMenu";
import { ListToolbar } from "@/features/ui/ListToolbar";
import { USERS_BULK_FORM, UsersBulkActions } from "@/features/admin/UsersBulkActions";
import { RowSelectBox } from "@/features/ui/BulkSelect";
import { ROLE_LABEL } from "@/features/ui/labels";
import { MODULE_HELP, MODULE_LABEL, MODULES, type ModuleCode } from "@/server/modules/modules";
import { SIGN_IN_LABEL } from "@/types/auth";
import { ListViews } from "@/features/lists/ListViews";
import { applyDefaultListView } from "@/server/lists/views";
import { nextDir, parseColumnSort, sortHref } from "@/server/lists/sorting";
import { groupRows, departmentBucket, pickGroup } from "@/server/lists/group-rows";
import { groupMenu, keepListState, USER_GROUPS, USER_SORT_COLUMNS, type UserGroup } from "@/server/admin/lists";
import { accessLabel } from "@/features/ui/labels";
import { ListPage } from "@/features/ui/ListPage";

// WEB-05 (v1.10.0): a plain, non-confidential browser title.
export const metadata: Metadata = { title: "Users & roles" };

const PAGE_SIZE = 50;

// F-06 user list. Search and filter are plain GET parameters.
export default async function UsersPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string; page?: string; module?: string; dept?: string; sortBy?: string; dir?: string; group?: string }> }) {
  const { user: actor } = await requireArea("admin");
  const params = await searchParams;
  // v1.58.0 (D-354, owner): your default saved view when the address is bare;
  // every column sorts both ways (on the server: the list is paged); Group by.
  await applyDefaultListView(actor.id, "list_admin_users", "/admin/users", params);
  const sort = parseColumnSort(params, USER_SORT_COLUMNS);
  const group = pickGroup(params.group, USER_GROUPS.map((choice) => choice.key)) as UserGroup | null;
  const search = (params.q ?? "").trim().slice(0, 100);
  const status = params.status === "inactive" || params.status === "all" ? params.status : "active";
  const page = Math.max(1, Number(params.page) || 1);
  // D-168: filter by module (anything else is ignored).
  const moduleFilter = (MODULES as readonly string[]).includes(params.module ?? "") ? (params.module as ModuleCode) : undefined;
  // v1.49.3 (owner): by department ("none": people without one).
  const departments = await listDepartments();
  const deptParam = params.dept ?? "";
  const departmentFilter = deptParam === "none" ? null : departments.some((item) => String(item.id) === deptParam) ? Number(deptParam) : undefined;
  const { items, total } = await listUsersForAdmin({ search: search || undefined, status, module: moduleFilter, departmentId: departmentFilter }, { limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE }, undefined, { sort, group });
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const link = (next: number) => `/admin/users?${new URLSearchParams({ ...(search ? { q: search } : {}), status, ...(moduleFilter ? { module: moduleFilter } : {}), ...(departmentFilter !== undefined ? { dept: deptParam } : {}), ...(sort.sortBy ? { sortBy: sort.sortBy, dir: sort.dir } : {}), ...(group ? { group } : {}), page: String(next) })}`;
  const groups = group
    ? groupRows(items, (user) =>
        group === "department" ? departmentBucket(user.departmentName) : group === "status" ? (user.active ? ["Active", 0] : ["Inactive", 1]) : group === "role" ? [accessLabel(user.roles), user.roles.includes("SUPER_ADMIN") ? 0 : user.roles.includes("IT_ADMIN") ? 1 : user.roles.length > 1 ? 2 : 3] : [SIGN_IN_LABEL[user.signInMethod], 0],
      ).map((entry) => ({ key: entry.key, label: entry.label, ids: entry.items.map((user) => user.id) }))
    : null;

  return (
    <ListPage
      header={
          <PageHeader title="Users & roles" description="Only people added here can sign in. People are made inactive, never deleted, so their history stays.">
            {/* v1.84.0 (D-411): Import data is the Super Admin's alone now. */}
            {actor.roles.includes("SUPER_ADMIN") && (
            <Link href="/superadmin/data/import?kind=users" className="btn-secondary btn-compact">
              Import
            </Link>
            )}
            <Link href="/admin/users/new" className="btn-primary btn-compact">
              <Plus aria-hidden="true" className="h-4 w-4" /> New user
            </Link>
          </PageHeader>
      }
    >
      {/* v1.51.1 (owner): the toolbar filters only (Filter, Search icon), like the task lists. */}
      <ListToolbar
        id="users-filters"
        path="/admin/users"
        label="Filter users"
        keep={keepListState(params)}
        search={{ name: "q", value: search, placeholder: "Name, email or User ID" }}
        group={groupMenu("/admin/users", params, USER_GROUPS, group)}
        filterCount={[status !== "active", moduleFilter, departmentFilter !== undefined].filter(Boolean).length}
        clearHref={search || status !== "active" || moduleFilter || departmentFilter !== undefined ? "/admin/users" : null}
        filters={
          <>
            <div>
              <label htmlFor="status" className="field-label">
                Status
              </label>
              <select id="status" name="status" defaultValue={status} className="field-input field-compact">
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
                <option value="all">All</option>
              </select>
            </div>
            <div>
              <label htmlFor="module" className="field-label">
                Module
              </label>
              <select id="module" name="module" defaultValue={moduleFilter ?? ""} className="field-input field-compact">
                <option value="">Any</option>
                {MODULES.map((module) => (
                  <option key={module} value={module}>
                    {MODULE_LABEL[module]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="dept" className="field-label">
                Department
              </label>
              <select id="dept" name="dept" defaultValue={departmentFilter === undefined ? "" : deptParam} className="field-input field-compact">
                <option value="">Any</option>
                {departments.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                    {item.active ? "" : " (inactive)"}
                  </option>
                ))}
                <option value="none">No department</option>
              </select>
            </div>
          </>
        }
      />

      <ListViews userId={actor.id} target="list_admin_users" path="/admin/users" query={params} />

      {/* v1.49.6 (owner): tick users, then one action for all of them. */}
      {items.length > 0 && <UsersBulkActions modules={MODULES.map((code) => ({ code, label: MODULE_LABEL[code], help: MODULE_HELP[code] }))} />}
      <DataTable
        caption="Users"
        storageKey="admin-users"
        empty={{ title: "No users found", body: search ? "Try a different search." : "Add the first user to get started." }}
        serverSort={{ sortBy: sort.sortBy, dir: sort.dir, hrefs: Object.fromEntries(USER_SORT_COLUMNS.map((column) => [column, sortHref("/admin/users", params, column, nextDir(sort, column))])) }}
        groups={groups}
        columns={[
          { key: "name", header: "Name", sortable: true },
          { key: "login", header: "User ID", sortable: true },
          { key: "department", header: "Department", sortable: true, optional: true },
          { key: "signIn", header: "Sign-in", sortable: true, optional: true },
          { key: "roles", header: "Roles", sortable: true, optional: true },
          { key: "modules", header: "Modules", sortable: true, optional: true },
          { key: "status", header: "Status", sortable: true },
          { key: "actions", header: "Actions" },
        ]}
        rows={items.map((user) => {
          const canEdit = user.id !== actor.id && checkCanEdit(actor, { id: user.id, roles: user.roles, active: user.active, isBreakGlass: user.isBreakGlass }).ok;
          return {
          id: user.id,
          sort: { name: user.name, login: user.loginId, department: user.departmentName, status: user.active ? 0 : 1 },
          cells: {
            name: (
              <>
                <span className="flex items-center gap-2">
                  {/* Only people you may change can be ticked (not yourself; another IT Admin only by the Super Admin). */}
                  {/* v1.74.1 (D-397): a row that can't be ticked keeps the box's room, so the names line up. */}
                  {canEdit ? <RowSelectBox formId={USERS_BULK_FORM} value={user.id} label={`Select ${user.name}`} testId="select-user" /> : <span aria-hidden="true" className="inline-block h-4 w-4 shrink-0" />}
                  <Link href={`/admin/users/${user.id}`} className="link">
                    {user.name}
                  </Link>
                </span>
                <span className="block text-caption text-ink-muted">
                  <Email address={user.email} />
                </span>
              </>
            ),
            login: user.loginId,
            department: user.departmentName ?? <span className="text-ink-faint">—</span>,
            signIn: SIGN_IN_LABEL[user.signInMethod],
            roles: user.roles.filter((role) => role !== "USER").map((role) => ROLE_LABEL[role]).join(", ") || "User",
            modules: user.roles.includes("SUPER_ADMIN") ? "All" : user.modules.map((module) => MODULE_LABEL[module]).join(", ") || <span className="text-ink-faint">None</span>,
            status: (
              <span className="inline-flex flex-wrap gap-1">
                <Badge tone={user.active ? "success" : "neutral"}>{user.active ? "Active" : "Inactive"}</Badge>
                {user.locked && <Badge tone="danger">Locked</Badge>}
                {user.isBreakGlass && <Badge tone="warning">Break-glass</Badge>}
              </span>
            ),
            // v1.49.3 (owner): Re-invite, set-password link, Deactivate / Activate in a three-dot menu.
            actions: (
              <UserRowMenu
                id={user.id}
                name={user.name}
                active={user.active}
                signInMethod={user.signInMethod}
                hasPassword={user.hasPassword}
                canEdit={canEdit}
              />
            ),
          },
          };
        })}
      />

      {pages > 1 && (
        <div className="mt-4 flex items-center gap-4 text-label">
          {page > 1 && (
            <Link className="link" href={link(page - 1)}>
              ← Previous
            </Link>
          )}
          <span className="text-ink-muted">
            Page {page} of {pages} · {total} users
          </span>
          {page < pages && (
            <Link className="link" href={link(page + 1)}>
              Next →
            </Link>
          )}
        </div>
      )}
    </ListPage>
  );
}
