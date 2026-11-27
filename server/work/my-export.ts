import { toCsv } from "@/server/import/csv";
import { COLUMN_LABEL, indiaDay, orderColumns, type GridColumn, type GridConfig, type GridGroupOut } from "@/server/work/grid";
import { visibilityLabel } from "@/server/work/my-sections";

// v1.76.0 (D-401, spec §3.3 / OQ-MYT-30): Task Summary's CSV. The current
// tab's tasks in the tab's order, with Task no., the name, the tab's visible
// columns, the group (when grouped), Status and Completed on. Pure and
// unit-tested; the route checks who may download (only their own list).
// v1.93.0 (D-446): + Start date and Last comment, in the tab's column order.
// Completed date isn't repeated: the file always ends with "Completed on".
export const SUMMARY_COLUMNS: readonly GridColumn[] = ["start", "due", "priority", "collaborators", "createdBy", "projects", "visibility", "lastComment"];
const PRIORITY_TEXT: Record<string, string> = { URGENT: "Critical", HIGH: "Most Important", IMPORTANT: "Important", ELEVATED: "High", NORMAL: "Normal", LOW: "Low" };
const STATUS_TEXT: Record<string, string> = { OPEN: "Open", IN_PROGRESS: "In progress", BLOCKED: "Blocked", COMPLETED: "Completed", CANCELLED: "Cancelled" };

export function summaryCsv(groups: readonly GridGroupOut[], config: Pick<GridConfig, "hidden" | "group" | "groupField"> & { columnOrder?: readonly string[] }): { csv: string; rows: number } {
  const columns = orderColumns(SUMMARY_COLUMNS, config.columnOrder ?? []).filter((column) => !config.hidden.includes(column));
  const grouped = config.group !== "none" || Boolean(config.groupField);
  const header = ["Task no.", "Task", ...columns.map((column) => COLUMN_LABEL[column]), ...(grouped ? ["Group"] : []), "Status", "Completed on"];
  const seen = new Set<number>();
  const lines: (string | number | null)[][] = [];
  for (const group of groups)
    for (const task of group.rows) {
      // A task in two groups (say two projects) is written once.
      if (seen.has(task.id)) continue;
      seen.add(task.id);
      const cell = (column: GridColumn): string => {
        switch (column) {
          case "due":
            return task.dueAt ? indiaDay(task.dueAt) : "";
          case "start":
            return task.startsOn ?? "";
          case "lastComment":
            return task.lastComment ? `${task.lastComment.authorName}: ${task.lastComment.text}` : "";
          case "priority":
            return PRIORITY_TEXT[task.priority] ?? task.priority;
          case "collaborators":
            return task.followers.map((person) => person.name).join("; ");
          case "createdBy":
            return task.createdByName;
          case "projects":
            return task.projects.map((project) => project.name).join("; ");
          case "visibility":
            return visibilityLabel(task.projects).text;
          default:
            return "";
        }
      };
      lines.push([task.taskNo, task.title, ...columns.map(cell), ...(grouped ? [group.name] : []), STATUS_TEXT[task.status] ?? task.status, task.completedAt ? indiaDay(task.completedAt) : ""]);
    }
  return { csv: toCsv(header, lines), rows: lines.length };
}

export const summaryFileName = (tabName: string, today: string) => `task-summary-${tabName.replace(/[^A-Za-z0-9 _-]+/g, "").trim().replace(/\s+/g, "-").slice(0, 40) || "list"}-${today}.csv`;
// At most 5 downloads an hour per person (spec validations).
export const EXPORTS_PER_HOUR = 5;
