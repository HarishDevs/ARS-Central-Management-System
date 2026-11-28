"use client";

import { useDateWords } from "@/features/ui/date-words";
import { CalendarDays, ChevronLeft, ChevronRight, Clock, Plus, Repeat, X } from "lucide-react";
import { useCallback, useEffect, useId, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type Ref } from "react";
import { useOverlay } from "@/features/ui/overlay-stack";
import {
  addDays,
  addMonths,
  dayOff,
  fieldText,
  formatDayRange,
  isRealDay,
  longDay,
  monthGrid,
  monthTitle,
  outOfBounds,
  parseDayInput,
  pickDay,
  previewRange,
  rangeRole,
  rangeText,
  shortDay,
  todayInIndia,
  typeDay,
  WEEK_HEAD,
  weekEnd,
  weekStart,
  type DateField,
  type Day,
  type PickerCalendar,
  type RangeDraft,
} from "@/features/ui/date-range";

// v1.75.0 (D-399, owner's screenshot: "use this kind so that from date to
// date can be captured"): ONE date picker for every From–To / start–due date
// in the PM screens. A button opens a popover (a bottom sheet below 768 px):
// two fields at the top (Start, shown as "+ Start date" until used, and
// Due/To; type dd-mm-yyyy or yyyy-mm-dd, or click the grid), the month as a
// Monday-first grid (days of the months around it dimmed, weekly offs and
// organisation holidays dimmed with their reason, today circled, the range
// shaded, a hover preview), and a footer with the time (clock), repeat (where
// it applies) and Clear. Keyboard: arrows by day, PageUp/PageDown by month
// (Shift: year), Home/End to the week's Monday/Sunday, Enter/Space picks,
// Escape closes and focus goes back to the button. Every rule is checked
// again on the server (due date mandatory for tasks, start ≤ due, holidays).

export interface DateRangeValue {
  start: Day | "";
  due: Day | "";
  startTime?: string; // HH:MM
  dueTime?: string; // HH:MM
}
export interface DateRangeHandle {
  open: (field?: DateField) => void;
}

// The organisation's calendar, fetched once per page load (and kept 5 minutes by the browser).
let calendarLoad: Promise<PickerCalendar | null> | null = null;
function loadCalendar(): Promise<PickerCalendar | null> {
  calendarLoad ??= fetch("/api/work/calendar", { credentials: "same-origin" })
    .then((response) => (response.ok ? (response.json() as Promise<PickerCalendar>) : null))
    .catch(() => null);
  return calendarLoad;
}
export function usePickerCalendar(given?: PickerCalendar | null, wanted = true): PickerCalendar | null {
  const [calendar, setCalendar] = useState<PickerCalendar | null>(given ?? null);
  useEffect(() => {
    if (given || !wanted) return;
    let live = true;
    void loadCalendar().then((value) => live && setCalendar(value));
    return () => {
      live = false;
    };
  }, [given, wanted]);
  return given ?? calendar;
}

function usePhone(): boolean {
  const [phone, setPhone] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(max-width: 767.98px)");
    const update = () => setPhone(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return phone;
}

const same = (a: DateRangeValue, b: DateRangeValue) => a.start === b.start && a.due === b.due && (a.startTime ?? "") === (b.startTime ?? "") && (a.dueTime ?? "") === (b.dueTime ?? "");

export function DateRangePicker({
  value,
  defaultValue = { start: "", due: "" },
  onChange,
  onCommit,
  mode = "range",
  label = "Dates",
  startLabel = "Start date",
  dueLabel = "Due date",
  dueRequired = false,
  time,
  onRepeat,
  repeatOn = false,
  min,
  max,
  names,
  idBase,
  calendar: givenCalendar,
  disabled = false,
  compact = false,
  triggerClass,
  triggerContent,
  triggerLabel,
  placeholder = "Choose dates",
  testId,
  triggerId,
  triggerDescribedBy,
  triggerInvalid,
  handle,
  weekdays,
}: {
  // v1.95.0 (D-471): weekday names in the trigger text; default from DateWordsProvider (off in PM screens).
  weekdays?: boolean;
  value?: DateRangeValue;
  defaultValue?: DateRangeValue;
  onChange?: (value: DateRangeValue) => void;
  onCommit?: (value: DateRangeValue) => void;
  mode?: "range" | "single";
  label?: string; // the dialog's name, e.g. "Task dates"
  startLabel?: string;
  dueLabel?: string;
  dueRequired?: boolean;
  time?: { due?: boolean; start?: boolean };
  onRepeat?: () => void;
  repeatOn?: boolean;
  min?: Day | "";
  max?: Day | "";
  names?: { start?: string; due?: string; dueTime?: string; startTime?: string }; // hidden inputs for a form
  idBase?: string; // ids of the fields: `${idBase}-start`, `${idBase}-due`, `${idBase}-due-time`
  calendar?: PickerCalendar | null;
  disabled?: boolean;
  compact?: boolean;
  triggerClass?: string;
  triggerContent?: React.ReactNode;
  triggerLabel?: string;
  placeholder?: string;
  testId?: string;
  triggerId?: string; // a <label htmlFor> outside names the button
  triggerDescribedBy?: string;
  triggerInvalid?: boolean;
  handle?: Ref<DateRangeHandle>;
}) {
  const auto = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const base = idBase ?? `drp-${auto}`;
  const single = mode === "single";
  const [inner, setInner] = useState<DateRangeValue>(value ?? defaultValue);
  // The picker keeps its own copy (a parent may only listen to onCommit); a new value from outside replaces it while closed.
  const current = inner;
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<DateField>("due");
  const [startShown, setStartShown] = useState(Boolean(current.start));
  const [showTime, setShowTime] = useState(false);
  const [typed, setTyped] = useState<{ start: string; due: string }>({ start: fieldText(current.start), due: fieldText(current.due) });
  const [problem, setProblem] = useState("");
  const [said, setSaid] = useState("");
  const [hover, setHover] = useState<Day | null>(null);
  const today = todayInIndia();
  const words = useDateWords();
  const useWeekdays = weekdays ?? words.weekdays;
  const [focusDay, setFocusDay] = useState<Day>(current.due || current.start || today);
  const calendar = usePickerCalendar(givenCalendar, open);
  const phone = usePhone();
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const grid = useRef<HTMLDivElement>(null);
  const snapshot = useRef<DateRangeValue>(current);
  const focusGrid = useRef(false);

  // A value from outside (a saved date, a parent's state) replaces the copy.
  const outside = value ? `${value.start}|${value.due}|${value.startTime ?? ""}|${value.dueTime ?? ""}` : null;
  useEffect(() => {
    if (outside === null || !value) return;
    setInner((was) => (same(was, value) ? was : value));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the value's text
  }, [outside]);
  // Fields follow the value while the picker is closed.
  useEffect(() => {
    if (open) return;
    setTyped({ start: fieldText(current.start), due: fieldText(current.due) });
    setStartShown(Boolean(current.start));
  }, [open, current.start, current.due]);

  const set = useCallback(
    (next: DateRangeValue) => {
      setInner(next);
      onChange?.(next);
    },
    [onChange],
  );

  const show = useCallback(
    (field?: DateField) => {
      if (disabled) return;
      snapshot.current = current;
      const want: DateField = single ? "due" : (field ?? (startShown && !current.start ? "start" : "due"));
      if (want === "start") setStartShown(true);
      setActive(want);
      setFocusDay((want === "start" ? current.start : current.due) || current.due || current.start || (min && today < min ? min : today));
      setProblem("");
      setShowTime(false);
      focusGrid.current = true;
      setOpen(true);
    },
    [current, disabled, single, startShown, min, today],
  );
  useImperativeHandle(handle, () => ({ open: show }), [show]);

  const close = useCallback(
    (back = true) => {
      setOpen(false);
      setHover(null);
      const done = current;
      if (onCommit && !same(done, snapshot.current)) {
        if (dueRequired && !done.due) {
          // A task's due date can't be removed: put it back and say so.
          set(snapshot.current);
          setSaid(`${dueLabel} is required: it was kept.`);
        } else onCommit(done);
      }
      if (back) window.requestAnimationFrame(() => trigger.current?.focus());
    },
    [current, onCommit, dueRequired, set, dueLabel],
  );

  // Outside clicks close (and commit); Escape is handled on the panel.
  // v1.87.0 (D-417): through the overlay stack, so only the top overlay reacts
  // (a date picker in the task pane closes; the pane stays).
  useOverlay(open, panel, {
    kind: "popover",
    modal: phone,
    restoreFocus: false,
    onOutside: () => close(false),
    onEscape: () => close(),
    ignore: (target) => Boolean(trigger.current?.contains(target)),
  });

  // Placement: against the window (position fixed) so a scrolling table or a
  // dialog can't clip it; corrected when an ancestor's transform moves "fixed".
  useLayoutEffect(() => {
    if (!open || phone || !panel.current) return;
    const place = () => {
      const box = panel.current;
      const anchor = trigger.current?.getBoundingClientRect();
      if (!box || !anchor) return;
      const width = box.offsetWidth;
      const height = box.offsetHeight;
      const below = window.innerHeight - anchor.bottom - 8;
      const up = below < height && anchor.top - 8 > below;
      const left = Math.min(Math.max(8, anchor.left), window.innerWidth - width - 8);
      const top = up ? Math.max(8, anchor.top - height - 4) : Math.min(anchor.bottom + 4, Math.max(8, window.innerHeight - height - 8));
      box.style.left = `${left}px`;
      box.style.top = `${top}px`;
      const real = box.getBoundingClientRect();
      if (Math.abs(real.left - left) > 0.5 || Math.abs(real.top - top) > 0.5) {
        box.style.left = `${left + (left - real.left)}px`;
        box.style.top = `${top + (top - real.top)}px`;
      }
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, phone, showTime, startShown, problem]);

  // The focused day takes focus when moved by keys (roving tabindex).
  useEffect(() => {
    if (!open || !focusGrid.current) return;
    focusGrid.current = false;
    grid.current?.querySelector<HTMLElement>(`[data-day="${focusDay}"]`)?.focus();
  }, [open, focusDay]);

  const draft: RangeDraft = { start: current.start, due: current.due };
  const shown = previewRange(draft, active, hover && !outOfBounds(hover, min, max) ? hover : null);
  const year = Number(focusDay.slice(0, 4));
  const month = Number(focusDay.slice(5, 7)) - 1;
  const weeks = useMemo(() => monthGrid(year, month), [year, month]);
  const announce = (next: RangeDraft, swapped: boolean) => {
    const text = single ? (next.due ? `${dueLabel}: ${longDay(next.due)}` : `No ${dueLabel.toLowerCase()}`) : rangeText(next, today, { start: startLabel.replace(/ date$/, ""), due: dueLabel.replace(/ date$/, "") });
    setSaid(swapped ? `${text}. The dates were swapped: the start can't be after the due date.` : text);
    setProblem(swapped ? "Swapped so the start comes first." : "");
  };

  const choose = (day: Day) => {
    if (outOfBounds(day, min, max)) {
      setProblem(min && day < min ? `Choose ${shortDay(min, today)} or later.` : `Choose ${max ? shortDay(max, today) : "an earlier day"} or earlier.`);
      return;
    }
    if (single) {
      const next = { ...current, due: day };
      set(next);
      setTyped((value) => ({ ...value, due: fieldText(day) }));
      announce({ start: "", due: day }, false);
      setFocusDay(day);
      // One day: picked and done.
      setOpen(false);
      setHover(null);
      if (onCommit && !same(next, snapshot.current)) onCommit(next);
      window.requestAnimationFrame(() => trigger.current?.focus());
      return;
    }
    const result = pickDay(draft, active, day, startShown);
    const next = { ...current, ...result.draft };
    set(next);
    setTyped({ start: fieldText(result.draft.start), due: fieldText(result.draft.due) });
    setActive(result.active);
    setFocusDay(day);
    announce(result.draft, result.swapped);
  };

  const typeInto = (field: DateField, text: string) => {
    setTyped((value) => ({ ...value, [field]: text }));
    if (!text.trim()) return;
    const day = parseDayInput(text);
    if (!day) return; // judged when the field is left
    if (outOfBounds(day, min, max)) return;
    const result = single ? { draft: { start: "", due: day } as RangeDraft, swapped: false } : typeDay(draft, field, day);
    set({ ...current, ...(single ? { due: day } : result.draft) });
    if (result.swapped) setTyped({ start: fieldText(result.draft.start), due: fieldText(result.draft.due) });
    setFocusDay(day);
    announce(result.draft, result.swapped);
  };
  const leaveField = (field: DateField) => {
    const text = typed[field].trim();
    if (!text) {
      if (current[field]) set({ ...current, [field]: "" });
      setProblem("");
      return;
    }
    const day = parseDayInput(text);
    if (!day) {
      setProblem("Enter a real date as dd-mm-yyyy (or yyyy-mm-dd).");
      return;
    }
    if (outOfBounds(day, min, max)) {
      setProblem(min && day < min ? `Choose ${shortDay(min, today)} or later.` : "That day is after the last allowed day.");
      return;
    }
    setTyped((value) => ({ ...value, [field]: fieldText(current[field] || day) }));
  };
  // × beside a field clears only that field; spec BR-DATE-002: a start needs a
  // due date, so clearing the due date clears the whole range.
  const clearField = (field: DateField) => {
    if (field === "due" && current.start && !single) {
      clearAll();
      return;
    }
    set({ ...current, [field]: "", ...(field === "start" ? { startTime: "" } : {}) });
    setTyped((value) => ({ ...value, [field]: "" }));
    if (field === "start") setStartShown(false);
    setActive(field === "start" ? "due" : field);
    setSaid(`${field === "start" ? startLabel : dueLabel} cleared.`);
  };
  function clearAll() {
    set({ ...current, start: "", due: "", startTime: "" });
    setTyped({ start: "", due: "" });
    setStartShown(false);
    setActive("due");
    setProblem("");
    setSaid("Dates cleared.");
  }

  const onGridKey = (event: React.KeyboardEvent) => {
    const moves: Record<string, (day: Day) => Day> = {
      ArrowLeft: (day) => addDays(day, -1),
      ArrowRight: (day) => addDays(day, 1),
      ArrowUp: (day) => addDays(day, -7),
      ArrowDown: (day) => addDays(day, 7),
      PageUp: (day) => addMonths(day, event.shiftKey ? -12 : -1),
      PageDown: (day) => addMonths(day, event.shiftKey ? 12 : 1),
      Home: weekStart,
      End: weekEnd,
    };
    const move = moves[event.key];
    if (move) {
      event.preventDefault();
      focusGrid.current = true;
      setFocusDay(move(focusDay));
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      choose(focusDay);
    }
  };

  // Spec DATE_RANGES §3: "30 Nov – 4 Dec", "7 – 11 Dec", "Tomorrow" …
  const triggerText = (() => {
    if (single) return current.due ? formatDayRange("", current.due, today, true, useWeekdays) : placeholder;
    if (current.start && !current.due) return `${formatDayRange(current.start, "", today, true, useWeekdays)} –`;
    return formatDayRange(current.start, current.due, today, true, useWeekdays) || placeholder;
  })();
  const triggerName = triggerLabel ?? `${label}: ${single ? (current.due ? longDay(current.due) : "none") : rangeText(draft, today, { start: startLabel.replace(/ date$/, ""), due: dueLabel.replace(/ date$/, "") })}. Change`;

  const field = (which: DateField) => {
    const id = `${base}-${which}`;
    const on = active === which;
    const name = which === "start" ? startLabel : dueLabel;
    return (
      <div className={`flex min-w-0 flex-1 items-center rounded-md border bg-surface ${on ? "border-primary-600 ring-1 ring-primary-600" : "border-line"}`}>
        <label htmlFor={id} className="sr-only">
          {name}
        </label>
        <input
          id={id}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          placeholder={name}
          title={`${name}: type dd-mm-yyyy or yyyy-mm-dd`}
          value={typed[which]}
          aria-invalid={problem.startsWith("Enter a real") && on ? true : undefined}
          aria-describedby={problem ? `${base}-problem` : undefined}
          onFocus={() => {
            setActive(which);
            if (current[which]) setFocusDay(current[which] as Day);
          }}
          onChange={(event) => typeInto(which, event.target.value)}
          onBlur={() => leaveField(which)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              event.stopPropagation();
              leaveField(which);
              const day = parseDayInput(typed[which]);
              if (day || !typed[which].trim()) close();
            }
          }}
          className="h-8 min-w-0 flex-1 bg-transparent px-2 text-label text-ink placeholder:text-ink-faint focus:outline-none"
          data-testid={`${testId ?? "date-picker"}-${which}`}
        />
        {(typed[which] || (which === "start" && startShown)) && (
          <button type="button" aria-label={`Clear ${name.toLowerCase()}`} onClick={() => clearField(which)} className="mr-1 grid h-6 w-6 shrink-0 place-items-center rounded text-ink-muted hover:bg-surface-muted hover:text-ink">
            <X aria-hidden="true" className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    );
  };

  const titleId = `${base}-month`;
  const panelBody = (
    <>
      <div className="flex items-center gap-2 p-3 pb-2">
        {!single &&
          (startShown ? (
            field("start")
          ) : (
            <button
              type="button"
              onClick={() => {
                setStartShown(true);
                setActive("start");
                window.requestAnimationFrame(() => document.getElementById(`${base}-start`)?.focus());
              }}
              className="inline-flex h-8 shrink-0 items-center gap-1 rounded-md px-2 text-label text-primary-700 hover:bg-primary-50"
              data-testid={`${testId ?? "date-picker"}-add-start`}
            >
              <Plus aria-hidden="true" className="h-3.5 w-3.5" /> {startLabel}
            </button>
          ))}
        {field("due")}
      </div>
      {showTime && (time?.due || time?.start) && (
        <div className="flex flex-wrap items-center gap-3 px-3 pb-2 text-label">
          {time?.start && startShown && (
            <label className="flex items-center gap-1.5 text-ink-muted">
              Start time
              <input id={`${base}-start-time`} type="time" step={1800} value={current.startTime ?? ""} onChange={(event) => set({ ...current, startTime: event.target.value })} className="field-input field-compact w-28 py-0 text-label" />
            </label>
          )}
          {time?.due && (
            <label className="flex items-center gap-1.5 text-ink-muted">
              {dueLabel.replace(/ date$/, "")} time
              <input id={`${base}-due-time`} type="time" step={1800} value={current.dueTime ?? ""} onChange={(event) => set({ ...current, dueTime: event.target.value || "23:59" })} className="field-input field-compact w-28 py-0 text-label" />
            </label>
          )}
        </div>
      )}
      <div className="flex items-center justify-between px-3 pb-1">
        <h3 id={titleId} className="text-label font-semibold text-ink" aria-live="polite">
          {monthTitle(year, month)}
        </h3>
        <span className="flex">
          <button type="button" aria-label="Previous month" onClick={() => setFocusDay(addMonths(focusDay, -1))} className="grid h-8 w-8 place-items-center rounded-md text-ink-muted hover:bg-surface-muted hover:text-ink">
            <ChevronLeft aria-hidden="true" className="h-4 w-4" />
          </button>
          <button type="button" aria-label="Next month" onClick={() => setFocusDay(addMonths(focusDay, 1))} className="grid h-8 w-8 place-items-center rounded-md text-ink-muted hover:bg-surface-muted hover:text-ink">
            <ChevronRight aria-hidden="true" className="h-4 w-4" />
          </button>
        </span>
      </div>
      <div ref={grid} role="grid" aria-labelledby={titleId} className="px-3" onKeyDown={onGridKey} onMouseLeave={() => setHover(null)} data-testid={`${testId ?? "date-picker"}-grid`}>
        <div role="row" className="grid grid-cols-7">
          {WEEK_HEAD.map((head, index) => (
            <span key={head.long} role="columnheader" aria-label={head.long} className={`grid h-7 place-items-center text-caption font-semibold ${index >= 5 ? "text-ink-faint" : "text-ink-muted"}`}>
              <span aria-hidden="true">{head.short}</span>
            </span>
          ))}
        </div>
        {weeks.map((week) => (
          <div role="row" key={week[0]!.day} className="grid grid-cols-7">
            {week.map((cell) => {
              const off = dayOff(cell.day, calendar);
              const role = rangeRole(cell.day, shown.start, shown.due);
              const blocked = outOfBounds(cell.day, min, max);
              const selected = role === "start" || role === "due" || role === "both";
              const isToday = cell.day === today;
              const parts = [longDay(cell.day)];
              if (role === "both") parts.push(single ? "selected" : "start and due");
              else if (role === "start") parts.push(startLabel.toLowerCase());
              else if (role === "due") parts.push(single ? "selected" : dueLabel.toLowerCase());
              else if (role === "inside") parts.push("in the range");
              if (isToday) parts.push("today");
              if (off.reason) parts.push(off.reason.toLowerCase().startsWith("holiday") ? off.reason.replace(/^Holiday/, "holiday") : "weekly off");
              if (blocked) parts.push("not available");
              // Spec DATE_RANGES §2.2/§9: a continuous band start → due with
              // rounded caps; weekly offs and holidays inside it a lighter tint.
              const band = Boolean(shown.start && shown.due && shown.start !== shown.due && (role === "start" || role === "due" || role === "inside"));
              const bandStyle = band ? { background: off.off && role === "inside" ? "color-mix(in srgb, var(--color-primary-50) 45%, transparent)" : "var(--color-primary-50)" } : undefined;
              const tone = role === "inside" ? (off.off || !cell.inMonth ? "text-ink-muted" : "text-primary-700") : !cell.inMonth || off.off || blocked ? "text-ink-faint" : "text-ink";
              return (
                <div
                  key={cell.day}
                  role="gridcell"
                  tabIndex={cell.day === focusDay ? 0 : -1}
                  aria-selected={selected}
                  aria-disabled={blocked || undefined}
                  aria-label={parts.join(", ")}
                  title={off.reason ?? undefined}
                  data-day={cell.day}
                  data-off={off.off || undefined}
                  data-outside={!cell.inMonth || undefined}
                  data-role={role ?? undefined}
                  data-in-range={band || undefined}
                  onClick={() => choose(cell.day)}
                  onMouseEnter={() => setHover(cell.day)}
                  onFocus={() => setFocusDay(cell.day)}
                  style={bandStyle}
                  className={`group relative grid h-9 cursor-pointer place-items-center text-label outline-none focus-visible:z-[1] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-600 ${band && role === "start" ? "rounded-l-full" : ""} ${band && role === "due" ? "rounded-r-full" : ""} ${!band ? "rounded-full" : ""} ${blocked ? "cursor-not-allowed" : ""} ${tone}`}
                >
                  <span
                    aria-hidden="true"
                    className={`grid h-8 w-8 place-items-center rounded-full ${selected ? "bg-primary-solid font-semibold text-on-solid" : isToday ? "border border-primary-600" : role === "inside" ? "" : "group-hover:bg-surface-muted"} ${off.reason?.startsWith("Holiday") && !selected ? "underline decoration-dotted underline-offset-2" : ""}`}
                  >
                    {Number(cell.day.slice(8, 10))}
                  </span>
                </div>
              );
            })}
          </div>
        ))}
      </div>
      {problem && (
        <p id={`${base}-problem`} role="alert" className="px-3 pt-2 text-caption text-warning-600">
          {problem}
        </p>
      )}
      <div className="mt-2 flex items-center gap-1 border-t border-line px-2 py-2">
        {(time?.due || time?.start) && (
          <button
            type="button"
            aria-label={showTime ? "Hide the time" : current.dueTime && current.dueTime !== "23:59" ? `Time: ${current.dueTime}. Change` : "Set a time"}
            aria-expanded={showTime}
            title="Time"
            onClick={() => setShowTime((value) => !value)}
            className={`grid h-8 w-8 place-items-center rounded-md hover:bg-surface-muted ${showTime ? "bg-primary-50 text-primary-700" : "text-ink-muted hover:text-ink"}`}
            data-testid={`${testId ?? "date-picker"}-time`}
          >
            <Clock aria-hidden="true" className="h-4 w-4" />
          </button>
        )}
        {onRepeat && (
          <button
            type="button"
            aria-label="Repeat (periodic)"
            aria-pressed={repeatOn}
            title="Repeat"
            onClick={() => {
              close();
              onRepeat();
            }}
            className={`grid h-8 w-8 place-items-center rounded-md hover:bg-surface-muted ${repeatOn ? "bg-primary-50 text-primary-700" : "text-ink-muted hover:text-ink"}`}
            data-testid={`${testId ?? "date-picker"}-repeat`}
          >
            <Repeat aria-hidden="true" className="h-4 w-4" />
          </button>
        )}
        <span className="flex-1" />
        <button type="button" onClick={clearAll} className="rounded-md px-2 py-1 text-label text-ink-muted hover:bg-surface-muted hover:text-ink">
          Clear
        </button>
        <button type="button" onClick={() => close()} className="btn-primary btn-compact" data-testid={`${testId ?? "date-picker"}-done`}>
          Done
        </button>
      </div>
    </>
  );

  return (
    <span className={`relative inline-flex min-w-0 ${compact ? "" : "max-w-full"}`} data-testid={testId}>
      <button
        ref={trigger}
        type="button"
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        id={triggerId}
        aria-label={triggerId && !triggerLabel ? undefined : triggerName}
        aria-describedby={triggerDescribedBy}
        data-invalid={triggerInvalid || undefined}
        title={triggerLabel ? undefined : triggerText}
        onClick={() => (open ? close() : show())}
        className={
          triggerClass ??
          `inline-flex min-w-0 items-center gap-1.5 rounded-md border border-line bg-surface text-left text-label hover:border-line-strong disabled:cursor-not-allowed disabled:opacity-60 ${compact ? "h-7 px-1.5" : "h-9 px-2.5"} ${current.due || current.start ? "text-ink" : "text-ink-muted"}`
        }
        data-testid={testId ? `${testId}-button` : undefined}
      >
        {triggerContent ?? (
          <>
            <CalendarDays aria-hidden="true" className="h-4 w-4 shrink-0 text-ink-muted" />
            <span className="truncate">{triggerText}</span>
          </>
        )}
      </button>
      {names?.start && <input type="hidden" name={names.start} value={current.start} />}
      {names?.due && <input type="hidden" name={names.due} value={current.due} />}
      {names?.dueTime && <input type="hidden" name={names.dueTime} value={current.dueTime ?? ""} />}
      {names?.startTime && <input type="hidden" name={names.startTime} value={current.startTime ?? ""} />}
      <span role="status" className="sr-only">
        {said}
      </span>
      {open && (
        <>
          {phone && <button type="button" aria-label="Close the date picker" tabIndex={-1} onClick={() => close()} className="fixed inset-0 z-popover bg-overlay" />}
          <div
            ref={panel}
            role="dialog"
            aria-label={label}
            aria-modal={phone ? true : undefined}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                close();
              }
            }}
            className={
              phone
                ? "mob-sheet fixed inset-x-0 bottom-0 z-popover max-h-[90dvh] overflow-y-auto rounded-t-2xl border-t border-line bg-raised pb-[env(safe-area-inset-bottom)] text-ink shadow-overlay"
                : "pop-in popover-surface fixed z-popover w-[19.5rem]"
            }
            style={phone ? undefined : { left: 0, top: 0 }}
            data-testid={testId ? `${testId}-panel` : "date-picker-panel"}
            data-sheet={phone || undefined}
            data-date-picker-open=""
          >
            {phone && <span aria-hidden="true" className="mx-auto mt-2 block h-1 w-10 rounded-full bg-line-strong" />}
            {panelBody}
          </div>
        </>
      )}
    </span>
  );
}

/** A day as a short label (shared by the screens that show what the picker holds). */
export function pickerDayText(day: string | null | undefined): string {
  return day && isRealDay(day) ? shortDay(day, todayInIndia()) : "";
}
