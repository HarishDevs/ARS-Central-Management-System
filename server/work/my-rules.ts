import "server-only";
import type { ResultSetHeader } from "mysql2/promise";
import { getDbPool, type Queryable } from "@/lib/db/client";
import { withTransaction } from "@/lib/db/transaction";
import { recordAudit } from "@/lib/db/repositories/audit.repository";
import * as repo from "@/lib/db/repositories/work.repository";
import { addDays, indiaDay } from "@/server/work/rules";
import { workCalendar } from "@/server/work/schedule-service";
import { DEFAULT_MY_RULES, MAX_UPCOMING_DAYS, myRulesSchema, promotionTarget, shouldRunFor, type MyRules, type MySystem } from "@/server/work/my-sections";
import type { WorkCalendar } from "@/server/work/schedule";
import type { TaskActor } from "@/server/modules/tasks";

// v1.76.0 (D-401, owner): Task Summary's section rules (spec §4.3, BR-MYT-012).
// Every night from 00:00 India time the job runner moves each open task that a
// rule matches into the rule's section (from any section), once per due day,
// and notes it in the task's activity (seen only by the person). Rules exist
// for a person once they use My sections; nobody else's sections are touched.
export const RULE_EVENT = "MY_SECTION_RULE";
const RULE_SECTION_NAME: Record<"TODAY" | "UPCOMING", string> = { TODAY: "Today", UPCOMING: "Upcoming" };

export async function myRules(userId: number, db: Queryable = getDbPool()): Promise<MyRules & { lastRunDay: string | null }> {
  const row = await repo.findMyRules(userId, db);
  return row ?? { ...DEFAULT_MY_RULES, lastRunDay: null };
}

// Moves the person's tasks by their rules for `today`. Idempotent: a task
// already moved for its due day (or already in the rule's section) stays.
export async function promoteForUser(userId: number, today: string, calendar: WorkCalendar, db: Queryable): Promise<number> {
  const rules = await repo.findMyRules(userId, db);
  if (!rules) return 0;
  const sections = await repo.ensureMySections(userId, db);
  const sectionOf = (key: MySystem) => sections.find((section) => section.system === key);
  const placements = await repo.myPlacementsWithRule(userId, db);
  // Far enough ahead for the Upcoming rule: N working days fit in 3N + 14 calendar days.
  const tasks = rules.todayOn || rules.upcomingOn ? await repo.openTasksDueBetween(userId, today, addDays(today, MAX_UPCOMING_DAYS * 3 + 14), db) : [];
  let moved = 0;
  for (const task of tasks) {
    const placement = placements.get(task.id) ?? null;
    const system = placement ? (sections.find((section) => section.id === placement.sectionId)?.system ?? null) : "RECENT";
    const target = promotionTarget({ open: true, dueDay: task.dueDay, system, ruleKey: placement?.ruleKey ?? null }, rules, today, calendar);
    if (!target) continue;
    const section = sectionOf(target.to);
    if (!section) continue;
    await repo.placeByRule(userId, task.id, section.id, target.key, db);
    const words = target.to === "TODAY" ? "it is due today" : `it is due within ${rules.upcomingDays} working day${rules.upcomingDays === 1 ? "" : "s"}`;
    // Straight into the activity (not the project automation outbox): a personal note.
    await db.query<ResultSetHeader>("INSERT INTO task_events (task_id, actor_id, event_type, body, payload_json) VALUES (?, ?, ?, ?, ?)", [
      task.id,
      userId,
      RULE_EVENT,
      `Moved to ${section.name || RULE_SECTION_NAME[target.to]} in Task Summary by a rule: ${words}.`,
      JSON.stringify({ userId, section: target.to, rule: target.key }),
    ]);
    moved += 1;
  }
  await repo.markRulesRun(userId, today, db);
  return moved;
}

// The job runner's step: everyone whose rules haven't run today (India).
export async function runMyTaskRules(now: Date = new Date()): Promise<{ myRulePeople: number; myRuleMoves: number }> {
  const today = indiaDay(now);
  const people = await repo.rulesDueFor(today, 500);
  if (!people.length) return { myRulePeople: 0, myRuleMoves: 0 };
  const calendar = await workCalendar(getDbPool());
  let moves = 0;
  for (const userId of people) {
    moves += await withTransaction(async (db) => {
      // Someone else's run may have done this person meanwhile.
      const fresh = await repo.findMyRules(userId, db);
      if (!fresh || !shouldRunFor(fresh.lastRunDay, today)) return 0;
      return promoteForUser(userId, today, calendar, db);
    });
  }
  return { myRulePeople: people.length, myRuleMoves: moves };
}

// The first use of My sections: the built-in sections and default rules,
// and one run of the rules now so the list isn't one long Recently assigned.
export async function startMySections(userId: number, now: Date = new Date()): Promise<void> {
  if (await repo.findMyRules(userId)) return;
  await withTransaction(async (db) => {
    await repo.ensureMySections(userId, db);
    if (!(await repo.ensureMyRules(userId, db))) return;
    await promoteForUser(userId, indiaDay(now), await workCalendar(db), db);
  });
}

export type RulesResult = { ok: true; message: string; moved: number } | { ok: false; message: string };
// The person changes their rules; they run at once for today too.
export async function saveRules(input: unknown, actor: TaskActor, now: Date = new Date()): Promise<RulesResult> {
  const parsed = myRulesSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: `Choose 1 to ${MAX_UPCOMING_DAYS} working days.` };
  const moved = await withTransaction(async (db) => {
    await repo.ensureMySections(actor.id, db);
    await repo.saveMyRules(actor.id, parsed.data, db);
    await recordAudit({ actorUserId: actor.id, action: "MY_TASKS_RULES_CHANGED", entityType: "USER", entityId: actor.id, sessionId: actor.sessionId, ipAddress: actor.ipAddress ?? null, metadata: { ...parsed.data } }, db);
    return promoteForUser(actor.id, indiaDay(now), await workCalendar(db), db);
  });
  return { ok: true, message: moved ? `Rules saved. ${moved} task${moved === 1 ? "" : "s"} moved now.` : "Rules saved. They run every night at midnight.", moved };
}

// The task pane's section picker (spec §3.16): only for the assignee, and
// only once they use My sections. Null otherwise.
export async function mySectionChoice(userId: number, taskId: number): Promise<{ sections: { id: number; name: string; system: string | null }[]; current: number | null } | null> {
  if (!(await repo.findMyRules(userId))) return null;
  const [sections, placements] = await Promise.all([repo.ensureMySections(userId), repo.myPlacements(userId)]);
  return { sections: sections.map((section) => ({ id: section.id, name: section.name, system: section.system })), current: placements.get(taskId)?.sectionId ?? null };
}
