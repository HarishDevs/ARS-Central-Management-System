"use server";

import { revalidatePath } from "next/cache";
import { requireApiArea } from "@/server/authorization/guards";
import { logError } from "@/lib/logging/logger";
import { saveLayout, saveNote } from "@/server/home/home-service";

// v1.63.0 (D-369, PM-A12): Home widgets and the private notepad. Always the
// signed-in person's own (no id is taken from the browser).
type Result = { ok: boolean; message: string; version?: number; conflict?: boolean };

async function me() {
  try {
    const session = await requireApiArea("users");
    return session.user;
  } catch {
    return null;
  }
}

export async function homeLayoutAction(input: unknown): Promise<Result> {
  const user = await me();
  if (!user) return { ok: false, message: "Not found." };
  const value = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  try {
    // v1.79.0 (D-406): the overview the layout belongs to (checked on the server; Tasks when not given).
    const result = await saveLayout(user, value.reset === true ? { reset: true, scope: value.scope } : { widgets: value.widgets, version: value.version, scope: value.scope });
    if (result.ok || result.conflict) revalidatePath("/users");
    return result.ok ? { ok: true, message: result.message, version: result.value.version } : { ok: false, message: result.message, conflict: result.conflict };
  } catch (error) {
    logError("homeLayoutAction failed", error);
    return { ok: false, message: "Couldn't save. Please try again." };
  }
}

export async function homeNoteAction(body: unknown, version: unknown): Promise<Result> {
  const user = await me();
  if (!user) return { ok: false, message: "Not found." };
  try {
    const result = await saveNote(user, body, version);
    return result.ok ? { ok: true, message: result.message, version: result.value.version } : { ok: false, message: result.message, conflict: result.conflict };
  } catch (error) {
    logError("homeNoteAction failed", error);
    return { ok: false, message: "Couldn't save your note. Please try again." };
  }
}
