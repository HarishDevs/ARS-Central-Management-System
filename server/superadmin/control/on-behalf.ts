import "server-only";
import { findUserById } from "@/lib/db/repositories/users.repository";
import { hasModule } from "@/server/modules/modules";
import type { ModuleCode, RoleCode } from "@/types/auth";

// v1.94.0 (D-458, owner 27 Nov 2026: Create = "On behalf of"): Super Admin
// picks the person an item is for (raises an approval as X, assigns a task
// from Y). The item is that person's in every way (requester / creator), so
// every normal rule applies to them, e.g. nobody approves their own request;
// it only records the Super Admin who made it (created_on_behalf_by) and
// shows "Created by Super Admin on behalf of X". Checked on the server for
// every create: only a Super Admin, only for an active, ordinary account that
// has the module, never for themselves.
export interface OnBehalfPerson {
  id: number;
  name: string;
  roles: RoleCode[];
  modules: ModuleCode[];
}

export type OnBehalfResult = { ok: true; person: OnBehalfPerson } | { ok: false; message: string };

export const ON_BEHALF_FIELD = "onBehalfOf";

export function parseOnBehalfId(value: unknown): number | null {
  return typeof value === "string" && /^\d{1,12}$/.test(value) ? Number(value) : null;
}

export async function resolveOnBehalf(actor: { id: number; roles: readonly string[] }, personId: number, module: ModuleCode): Promise<OnBehalfResult> {
  if (!actor.roles.includes("SUPER_ADMIN")) return { ok: false, message: "Not found." };
  if (personId === actor.id)
    return {
      ok: false,
      message: "Choose someone else: you raise your own items as usual.",
    };
  const person = await findUserById(personId);
  if (!person || !person.active || person.isBreakGlass || person.isSystem) return { ok: false, message: "Choose an active person." };
  if (!hasModule({ roles: person.roles, modules: person.modules }, module))
    return {
      ok: false,
      message: `${person.name} doesn't have this module, so it can't be raised for them.`,
    };
  return {
    ok: true,
    person: {
      id: person.id,
      name: person.name,
      roles: person.roles,
      modules: person.modules,
    },
  };
}
