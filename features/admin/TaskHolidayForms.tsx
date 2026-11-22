"use client";

import { departmentHolidayAction, holidayTasksAction, saveAutomationLimitsAction, saveFieldLimitsAction, savePmExtrasAction, saveTaskExtrasAction, saveTaskHolidaySettingsAction } from "@/app/admin/task-holidays/actions";
import type { FieldLimits } from "@/server/work/custom-fields";
import type { AutomationLimits } from "@/server/work/automation-rules";
import { CELEBRATION_LABEL, CELEBRATIONS, PURGE_DAYS, type PmExtras } from "@/server/work/pm-rules";
import type { DigestSettings, RecurrenceSettings } from "@/server/work/more-rules";
import { FieldError, ResultMessage, SubmitButton, useActionForm } from "@/features/ui/form";
import { HOLIDAY_MODE_LABEL, HOLIDAY_MODES, type HolidaySettings } from "@/server/work/holidays";

// D-217: Admin → Task holidays.
export function TaskHolidaySettingsForm({ settings }: { settings: HolidaySettings }) {
  const { result, pending, onSubmit } = useActionForm(saveTaskHolidaySettingsAction);
  const box = (name: keyof HolidaySettings, label: string, hint: string) => (
    <label className="flex items-start gap-2 text-body">
      <input type="checkbox" name={name} defaultChecked={Boolean(settings[name])} className="mt-1" />
      <span>
        {label}
        <span className="block text-caption text-ink-muted">{hint}</span>
      </span>
    </label>
  );
  return (
    <form onSubmit={onSubmit} className="space-y-5 px-5 py-4" aria-label="Task holiday settings">
      <fieldset>
        <legend className="field-label">When a task&apos;s date falls on a holiday</legend>
        <div className="space-y-1.5">
          {HOLIDAY_MODES.map((mode) => (
            <label key={mode} className="flex items-center gap-2 text-body">
              <input type="radio" name="mode" value={mode} defaultChecked={settings.mode === mode} />
              {HOLIDAY_MODE_LABEL[mode]}
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend className="field-label">The working day offered instead</legend>
        <div className="flex gap-4">
          <label className="flex items-center gap-2 text-body">
            <input type="radio" name="suggest" value="NEXT" defaultChecked={settings.suggest === "NEXT"} /> The next working day
          </label>
          <label className="flex items-center gap-2 text-body">
            <input type="radio" name="suggest" value="PREVIOUS" defaultChecked={settings.suggest === "PREVIOUS"} /> The working day before
          </label>
        </div>
      </fieldset>
      <div className="space-y-3">
        {box("weeklyOff", "Weekly offs count as holidays", "Days that aren't working days in the Working calendar (for example Sunday) are treated like holidays.")}
        {box("checkStart", "Check start dates too", "Not only due dates: a start date on a holiday gets the same warning.")}
        {box("holdReminders", "No task reminders on holidays", "Due-soon and overdue reminders wait for the next working day.")}
        {box("showOnCalendars", "Show holidays on task calendars and timelines", "Holidays are shaded with their name in project and My Tasks calendars.")}
        {box("notifyNewHoliday", "Tell people when a new holiday lands on their tasks", "When IT adds a holiday, the assignees of open tasks due that day are told, so they can keep or move them.")}
      </div>
      <ResultMessage result={result} />
      <SubmitButton pending={pending}>Save</SubmitButton>
    </form>
  );
}

export function HolidayTasksButtons({ date, count }: { date: string; count: number }) {
  const { result, pending, onSubmit } = useActionForm(holidayTasksAction);
  if (count === 0) return <span className="text-caption text-ink-muted">No open tasks due</span>;
  return (
    <form onSubmit={onSubmit} className="flex flex-wrap items-center gap-2" aria-label={`Tasks due on ${date}`}>
      <input type="hidden" name="date" value={date} />
      <button type="submit" name="command" value="NEXT" disabled={pending} className="btn-secondary btn-compact">
        Move to next working day
      </button>
      <button type="submit" name="command" value="PREVIOUS" disabled={pending} className="btn-secondary btn-compact">
        Move to day before
      </button>
      <button type="submit" name="command" value="TELL" disabled={pending} className="btn-secondary btn-compact">
        Tell the assignees
      </button>
      <ResultMessage result={result} />
    </form>
  );
}

// D-218: the morning summary and repeating tasks.
export function TaskExtrasForm({ digest, recurrence }: { digest: DigestSettings; recurrence: RecurrenceSettings }) {
  const { result, pending, onSubmit } = useActionForm(saveTaskExtrasAction);
  return (
    <form onSubmit={onSubmit} className="space-y-4 px-5 py-4" aria-label="Morning summary and repeating tasks">
      <fieldset className="space-y-2">
        <legend className="field-label">Morning summary</legend>
        <label className="flex items-center gap-2 text-body">
          <input type="checkbox" name="digestEnabled" defaultChecked={digest.enabled} /> Send each person a summary of their overdue, due-today and new tasks (in-app and email)
        </label>
        <label className="flex items-center gap-2 text-body">
          From
          <select name="digestHour" defaultValue={digest.hour} className="field-input h-8 w-auto py-0" aria-label="Summary hour">
            {[5, 6, 7, 8, 9, 10, 11, 12].map((hour) => (
              <option key={hour} value={hour}>
                {hour}:00
              </option>
            ))}
          </select>
          India time
        </label>
        <label className="flex items-center gap-2 text-body">
          <input type="checkbox" name="digestWorkingDays" defaultChecked={digest.workingDaysOnly} /> Only on working days (not on holidays or weekly offs)
        </label>
        <p className="text-caption text-ink-muted">Nobody gets an empty summary; anyone can switch theirs off in My Tasks.</p>
      </fieldset>
      <fieldset className="space-y-2">
        <legend className="field-label">Repeating tasks</legend>
        <label className="flex items-center gap-2 text-body">
          <input type="checkbox" name="recurrenceEnabled" defaultChecked={recurrence.enabled} /> People may make tasks repeat (daily, weekly, monthly, yearly, or some days after completion)
        </label>
        <label className="flex items-center gap-2 text-body">
          <input type="checkbox" name="recurrenceSkipHolidays" defaultChecked={recurrence.skipHolidays} /> The next one never falls on a holiday (it moves to the next working day)
        </label>
      </fieldset>
      <ResultMessage result={result} />
      <SubmitButton pending={pending}>Save</SubmitButton>
    </form>
  );
}

export function DepartmentHolidayForm({ departments }: { departments: { id: number; name: string }[] }) {
  const { result, pending, onSubmit, formRef } = useActionForm(departmentHolidayAction, { resetOnSuccess: true });
  return (
    <form ref={formRef} onSubmit={onSubmit} className="grid gap-3 px-5 py-4 md:grid-cols-2" aria-label="Add a department holiday">
      <input type="hidden" name="command" value="add" />
      <div>
        <label htmlFor="dept-holiday-department" className="field-label">
          Department
        </label>
        <select id="dept-holiday-department" name="department" required defaultValue="" className="field-input">
          <option value="" disabled>
            Choose…
          </option>
          {departments.map((department) => (
            <option key={department.id} value={department.id}>
              {department.name}
            </option>
          ))}
        </select>
        <FieldError result={result} name="department" />
      </div>
      <div>
        <label htmlFor="dept-holiday-date" className="field-label">
          Date
        </label>
        <input id="dept-holiday-date" type="date" name="date" required className="field-input" />
        <FieldError result={result} name="date" />
      </div>
      <div className="md:col-span-2">
        <label htmlFor="dept-holiday-name" className="field-label">
          Name
        </label>
        <input id="dept-holiday-name" name="name" required minLength={2} maxLength={100} placeholder="e.g. Plant maintenance shutdown" className="field-input" />
        <FieldError result={result} name="name" />
      </div>
      <div className="md:col-span-2 flex items-center gap-3">
        <SubmitButton pending={pending}>Add department holiday</SubmitButton>
        <ResultMessage result={result} />
      </div>
    </form>
  );
}

export function RemoveDepartmentHolidayButton({ departmentId, date }: { departmentId: number; date: string }) {
  const { result, pending, onSubmit } = useActionForm(departmentHolidayAction);
  return (
    <form onSubmit={onSubmit} className="flex items-center gap-2">
      <input type="hidden" name="command" value="remove" />
      <input type="hidden" name="department" value={departmentId} />
      <input type="hidden" name="date" value={date} />
      <button type="submit" disabled={pending} className="btn-secondary btn-compact">
        Remove
      </button>
      {result && !result.ok && <ResultMessage result={result} />}
    </form>
  );
}

// v1.62.0 (D-368): celebrations default and the 30-day purge of Deleted.
export function PmExtrasForm({ extras }: { extras: PmExtras }) {
  const { result, pending, onSubmit } = useActionForm(savePmExtrasAction);
  return (
    <form onSubmit={onSubmit} className="space-y-4 px-5 py-4" aria-label="Celebrations and deleted items">
      <fieldset className="space-y-2">
        <legend className="field-label">Celebrations when someone completes a task (default)</legend>
        <select name="celebrations" defaultValue={extras.celebrations} className="field-input h-9 w-auto py-0" aria-label="Celebrations default">
          {CELEBRATIONS.map((choice) => (
            <option key={choice} value={choice}>
              {CELEBRATION_LABEL[choice]}
            </option>
          ))}
        </select>
        <p className="text-caption text-ink-muted">Occasional is about one completion in four. Each person can choose their own in Profile; nothing moves for people whose device asks for reduced motion.</p>
      </fieldset>
      <fieldset className="space-y-2">
        <legend className="field-label">Deleted tasks and projects</legend>
        <label className="flex items-start gap-2 text-body">
          <input type="checkbox" name="purge" defaultChecked={extras.purge} className="mt-1" /> Remove them for good after {PURGE_DAYS} days in Deleted (with their comments, files and fields)
        </label>
        <p className="text-caption text-ink-muted">Off: they stay in Deleted (restorable by the people who could restore them) until this is turned on again. A ticket&apos;s or meeting&apos;s task, and tasks of requests under a legal hold, are always kept.</p>
      </fieldset>
      <ResultMessage result={result} />
      <SubmitButton pending={pending}>Save</SubmitButton>
    </form>
  );
}

// v1.64.0 (D-371, C-8): custom field limits.
export function FieldLimitsForm({ limits }: { limits: FieldLimits }) {
  const { result, pending, onSubmit } = useActionForm(saveFieldLimitsAction);
  return (
    <form onSubmit={onSubmit} className="space-y-4 px-5 py-4" aria-label="Custom field limits" data-testid="field-limits">
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <label htmlFor="limit-project" className="field-label">
            Fields per project
          </label>
          <input id="limit-project" name="perProject" type="number" min={1} max={500} defaultValue={limits.perProject} className="field-input h-9" />
        </div>
        <div>
          <label htmlFor="limit-task" className="field-label">
            Fields with values per task
          </label>
          <input id="limit-task" name="perTask" type="number" min={1} max={200} defaultValue={limits.perTask} className="field-input h-9" />
        </div>
        <div>
          <label htmlFor="limit-options" className="field-label">
            Options per field
          </label>
          <input id="limit-options" name="options" type="number" min={2} max={1000} defaultValue={limits.options} className="field-input h-9" />
        </div>
      </div>
      <p className="text-caption text-ink-muted">Checked every time someone adds a field, an option or a value. Lowering a limit doesn&apos;t remove anything already there; it only stops new additions.</p>
      <ResultMessage result={result} />
      <SubmitButton pending={pending}>Save</SubmitButton>
    </form>
  );
}

// v1.68.0 (D-380, C-8): project automation limits.
export function AutomationLimitsForm({ limits }: { limits: AutomationLimits }) {
  const { result, pending, onSubmit } = useActionForm(saveAutomationLimitsAction);
  return (
    <form onSubmit={onSubmit} className="space-y-4 px-5 py-4" aria-label="Project automation limits" data-testid="automation-limits">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="limit-rules" className="field-label">
            Automations per project
          </label>
          <input id="limit-rules" name="perProject" type="number" min={1} max={200} defaultValue={limits.perProject} className="field-input h-9" />
        </div>
        <div>
          <label htmlFor="limit-steps" className="field-label">
            Steps per automation
          </label>
          <input id="limit-steps" name="stepsPerRule" type="number" min={1} max={50} defaultValue={limits.stepsPerRule} className="field-input h-9" />
        </div>
      </div>
      <p className="text-caption text-ink-muted">Checked when someone adds an automation and when they publish one. Lowering a limit doesn&apos;t remove anything; existing automations keep running. Loop protection (at most 3 automations in a chain, 500 runs an hour per automation) is fixed.</p>
      <ResultMessage result={result} />
      <SubmitButton pending={pending}>Save</SubmitButton>
    </form>
  );
}
