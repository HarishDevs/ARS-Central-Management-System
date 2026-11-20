"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { GripVertical } from "lucide-react";
import { saveListColumnsAction } from "@/app/users/list-actions";
import { SortLink } from "@/features/ui/SortTh";
import type { SortDir } from "@/server/lists/sorting";

// v1.52.3 (owner: "make each column of the tables re-arrangeable: drag and
// rearrange the columns and save it as a view for that user"): the title row
// of a request table. Drag a column title onto another to move it there; the
// order is saved on the person's account (with the Columns choice) and used
// on every visit. Keyboard: Alt+← / Alt+→ on a focused title moves it.
export interface HeaderColumn {
  key: string;
  label: string;
  className?: string;
  srOnly?: boolean;
}

// v1.58.0 (D-354, owner: "sorting in all the tables asc to desc or vice versa in
// all columns"): with `sort`, each title (and the lead "Request" title, key
// `leadKey`) is also a sort link; the grip still drags the column. `hrefs` holds
// the address for each column's next direction (built on the server).
export interface HeaderSort {
  sortBy: string | null;
  dir: SortDir;
  hrefs: Record<string, string>;
  leadKey?: string;
}

const ariaSort = (sort: HeaderSort | undefined, key: string) => (sort && sort.hrefs[key] ? (sort.sortBy === key ? (sort.dir === "asc" ? "ascending" : "descending") : "none") : undefined);

// v1.59.0: `trailing` adds a last, fixed column (e.g. the row's Change details button), named for screen readers.
export function ReorderHeader({ list, lead, columns, hidden = [], sort, trailing }: { list: string; lead: string; columns: HeaderColumn[]; hidden?: string[]; sort?: HeaderSort; trailing?: string }) {
  const router = useRouter();
  // The order shown is the saved one: titles and cells move together once the
  // page has the new order (a short "Saving…" in between), never apart.
  const saved = columns.map((column) => column.key).join(",");
  const [order, setOrder] = useState(columns.map((column) => column.key));
  useEffect(() => setOrder(saved.split(",").filter(Boolean)), [saved]);
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const byKey = new Map(columns.map((column) => [column.key, column]));
  const save = (next: string[]) => {
    start(async () => {
      // Hidden columns stay hidden: only the shown ones are saved, in this order.
      await saveListColumnsAction(list, next.filter((key) => !hidden.includes(key)));
      router.refresh();
    });
  };
  const move = (key: string, target: string) => {
    if (key === target) return;
    const next = order.filter((item) => item !== key);
    next.splice(next.indexOf(target) + (order.indexOf(key) < order.indexOf(target) ? 1 : 0), 0, key);
    save(next);
  };
  const shift = (key: string, by: number) => {
    const at = order.indexOf(key);
    const to = at + by;
    if (to < 0 || to >= order.length) return;
    const next = [...order];
    next.splice(at, 1);
    next.splice(to, 0, key);
    save(next);
  };
  return (
    <tr data-testid={`reorder-${list}`} aria-busy={pending || undefined} className={pending ? "opacity-60" : undefined}>
      <th scope="col" aria-sort={sort?.leadKey ? ariaSort(sort, sort.leadKey) : undefined} data-sort-column={sort?.leadKey}>
        {sort?.leadKey && sort.hrefs[sort.leadKey] ? <SortLink label={lead} active={sort.sortBy === sort.leadKey} dir={sort.dir} href={sort.hrefs[sort.leadKey]!} /> : lead}
        {pending && <span className="ml-2 text-caption font-normal normal-case text-ink-muted">Saving…</span>}
      </th>
      {order.map((key) => {
        const column = byKey.get(key);
        if (!column) return null;
        return (
          <th
            key={key}
            scope="col"
            className={`${column.className ?? ""} select-none ${over === key && dragging && dragging !== key ? "bg-primary-50" : ""} ${dragging === key ? "opacity-50" : ""}`}
            draggable
            tabIndex={0}
            aria-label={`${column.label}. Drag, or Alt and an arrow key, to move this column`}
            title="Drag to move this column"
            data-column={key}
            aria-sort={ariaSort(sort, key)}
            onDragStart={(event) => {
              setDragging(key);
              event.dataTransfer.effectAllowed = "move";
              event.dataTransfer.setData("text/plain", key);
            }}
            onDragOver={(event) => {
              if (!dragging) return;
              event.preventDefault();
              event.dataTransfer.dropEffect = "move";
              setOver(key);
            }}
            onDragLeave={() => setOver((current) => (current === key ? null : current))}
            onDrop={(event) => {
              event.preventDefault();
              const from = event.dataTransfer.getData("text/plain") || dragging;
              setDragging(null);
              setOver(null);
              if (from) move(from, key);
            }}
            onDragEnd={() => {
              setDragging(null);
              setOver(null);
            }}
            onKeyDown={(event) => {
              if (!event.altKey) return;
              if (event.key === "ArrowLeft") {
                event.preventDefault();
                shift(key, -1);
              } else if (event.key === "ArrowRight") {
                event.preventDefault();
                shift(key, 1);
              }
            }}
          >
            <span className="inline-flex cursor-grab items-center gap-1 active:cursor-grabbing">
              <GripVertical aria-hidden="true" className="h-3.5 w-3.5 text-ink-faint" />
              {/* v1.58.0 (D-354): the title sorts; dragging it still moves the column. */}
              {sort?.hrefs[key] ? (
                <SortLink label={column.label} active={sort.sortBy === key} dir={sort.dir} href={sort.hrefs[key]!} srOnly={column.srOnly} />
              ) : column.srOnly ? (
                <span className="sr-only">{column.label}</span>
              ) : (
                column.label
              )}
            </span>
          </th>
        );
      })}
      {trailing && (
        <th scope="col">
          <span className="sr-only">{trailing}</span>
        </th>
      )}
    </tr>
  );
}
