"use server";

import { requireApiArea } from "@/server/authorization/guards";
import { getActionContext } from "@/lib/http/request-context";
import { setItemProvided, type TickResult } from "@/server/records/item-checks";
import { LIMITS, overLimit } from "@/server/security/limits";
import { logError } from "@/lib/logging/logger";

// v1.57.0 (D-335): tick (or untick) one line of an Item list as provided.
// The service re-checks who may, against the record and its form.
export async function setItemProvidedAction(input: { entityType: "REQUEST" | "TICKET"; entityId: number; fieldKey: string; lineNo: number; provided: boolean }): Promise<TickResult> {
  try {
    const session = await requireApiArea("users");
    if (input.entityType !== "REQUEST" && input.entityType !== "TICKET") return { ok: false, message: "Not found." };
    if (await overLimit(`item-tick:${session.user.id}`, LIMITS.itemTick)) return { ok: false, message: "That's a lot of changes in a short time. Please wait a moment." };
    const { ipAddress } = await getActionContext();
    return await setItemProvided(
      { entityType: input.entityType, entityId: Number(input.entityId), fieldKey: String(input.fieldKey), lineNo: Number(input.lineNo), provided: Boolean(input.provided) },
      { id: session.user.id, name: session.user.name, roles: session.user.roles, sessionId: session.sessionId, ipAddress },
    );
  } catch (error) {
    logError("setItemProvidedAction failed", error);
    return { ok: false, message: "Couldn't save the tick. Please try again." };
  }
}
