"use client";

import { ArrowLeft, Briefcase, CalendarRange, Gauge, LayoutDashboard, List, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { createPortfolioAction } from "@/app/users/work/portfolio-actions";
import { guardCall } from "@/features/ui/form";
import { PersonSelect, type PersonChoice } from "@/features/ui/PersonSelect";
import { COLOR_HEX, ProjectDot } from "@/features/work/client";
import { PRIVACY, PRIVACY_LABEL, PROJECT_COLORS, PROJECT_ROLE_LABEL, type ProjectRole } from "@/server/work/access";

// v1.69.0 (D-382, spec PORTFOLIOS §3.2-3.3): a new portfolio in three steps:
// 1. name, colour, who can see it and the tab it opens on; 2. projects (and
// portfolios) to add, from those the person can see; 3. people with a role.
// Nothing is saved until Create portfolio (BR-PORT-004).
type Step = 1 | 2 | 3;
const TABS = [
  { key: "LIST", label: "List", icon: List, hint: "Rows with status and progress" },
  { key: "TIMELINE", label: "Timeline", icon: CalendarRange, hint: "Bars by quarter" },
  { key: "PROGRESS", label: "Progress", icon: Gauge, hint: "Status and updates" },
  { key: "DASHBOARD", label: "Dashboard", icon: LayoutDashboard, hint: "Charts across projects" },
] as const;
const COLOR_LABEL: Record<string, string> = { green: "Green", blue: "Blue", teal: "Teal", amber: "Amber", red: "Orange", purple: "Purple", pink: "Pink", gray: "Grey" };

export function PortfolioWizard({
  projects,
  portfolios,
  departments,
  myDepartmentId,
  people,
  meId,
}: {
  projects: { id: number; name: string; color: string }[];
  portfolios: { id: number; name: string; color: string; items: number }[];
  departments: { id: number; name: string }[];
  myDepartmentId: number | null;
  people: PersonChoice[];
  meId: number;
}) {
  const router = useRouter();
  const id = useId();
  const [step, setStep] = useState<Step>(1);
  const [name, setName] = useState("");
  const [color, setColor] = useState("blue");
  const [privacy, setPrivacy] = useState("PRIVATE");
  const [department, setDepartment] = useState<number | "">(myDepartmentId ?? "");
  const [tab, setTab] = useState("LIST");
  const [query, setQuery] = useState("");
  const [chosenProjects, setChosenProjects] = useState<number[]>([]);
  const [chosenPortfolios, setChosenPortfolios] = useState<number[]>([]);
  const [members, setMembers] = useState<{ id: number; role: ProjectRole }[]>([]);
  const [who, setWho] = useState<number | null>(null);
  const [role, setRole] = useState<ProjectRole>("EDITOR");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const words = query.trim().toLowerCase();
  const shownProjects = projects.filter((item) => !words || item.name.toLowerCase().includes(words)).slice(0, 100);
  const shownPortfolios = portfolios.filter((item) => !words || item.name.toLowerCase().includes(words)).slice(0, 50);
  const toggle = (list: number[], set: (next: number[]) => void, value: number) => set(list.includes(value) ? list.filter((item) => item !== value) : [...list, value]);
  const personName = (personId: number) => people.find((person) => person.id === personId)?.label ?? "Someone";

  const create = async () => {
    setBusy(true);
    setError("");
    const result = (await guardCall(() =>
      createPortfolioAction({ name, color, privacy, departmentId: privacy === "DEPARTMENT" && department !== "" ? department : null, defaultTab: tab, projectIds: chosenProjects, portfolioIds: chosenPortfolios, members }),
    )) as { ok: boolean; message?: string; value?: { id: number } };
    if (result.ok && result.value) {
      router.push(`/users/work/portfolios/${result.value.id}?created=1`);
      return;
    }
    setBusy(false);
    setError(result.message || "Couldn't create the portfolio.");
  };

  const stepper = (
    <ol className="mb-6 flex flex-wrap gap-2 text-caption" aria-label="Steps">
      {(["Details", "Add projects", "Add people"] as const).map((label, index) => (
        <li key={label} aria-current={step === index + 1 ? "step" : undefined} className={`rounded-full px-3 py-1 ${step === index + 1 ? "bg-primary-50 font-semibold text-primary-700" : "text-ink-muted"}`}>
          {index + 1}. {label}
        </li>
      ))}
    </ol>
  );

  return (
    <div className="mx-auto min-w-0 max-w-3xl [overflow-wrap:anywhere]" data-testid="new-portfolio">
      <div className="mb-4 flex items-center gap-2">
        {step > 1 ? (
          <button type="button" onClick={() => setStep((step - 1) as Step)} className="btn-secondary btn-compact inline-flex items-center gap-1">
            <ArrowLeft aria-hidden="true" className="h-4 w-4" /> Back
          </button>
        ) : (
          <Link href="/users/work/portfolios" className="btn-secondary btn-compact inline-flex items-center gap-1">
            <ArrowLeft aria-hidden="true" className="h-4 w-4" /> Portfolios
          </Link>
        )}
        <h1 className="flex items-center gap-2 text-page-title">
          <Briefcase aria-hidden="true" className="h-5 w-5 text-ink-muted" /> New portfolio
        </h1>
      </div>
      {stepper}

      {step === 1 && (
        <form
          className="card space-y-5 p-5"
          onSubmit={(event) => {
            event.preventDefault();
            if (name.trim()) setStep(2);
          }}
        >
          <div>
            <label htmlFor={`${id}-name`} className="field-label">
              Portfolio name
            </label>
            <input id={`${id}-name`} autoFocus value={name} onChange={(event) => setName(event.target.value)} maxLength={150} className="field-input" placeholder="e.g. Plant upgrades 2027" required data-testid="portfolio-name" />
          </div>
          <fieldset>
            <legend className="field-label">Colour</legend>
            <div className="flex flex-wrap gap-2">
              {PROJECT_COLORS.map((key) => (
                <label key={key} className="relative cursor-pointer" title={COLOR_LABEL[key]}>
                  <input type="radio" name="color" value={key} checked={color === key} onChange={() => setColor(key)} className="peer sr-only" aria-label={COLOR_LABEL[key]} />
                  <span aria-hidden="true" className="block h-8 w-8 rounded-md ring-offset-2 ring-offset-surface peer-checked:ring-2 peer-checked:ring-primary-600 peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-primary-600" style={{ backgroundColor: COLOR_HEX[key] }} />
                </label>
              ))}
            </div>
          </fieldset>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor={`${id}-privacy`} className="field-label">
                Who can see it
              </label>
              <select id={`${id}-privacy`} value={privacy} onChange={(event) => setPrivacy(event.target.value)} className="field-input" data-testid="portfolio-privacy">
                {PRIVACY.map((key) => (
                  <option key={key} value={key}>
                    {key === "PRIVATE" ? "Private to portfolio members" : PRIVACY_LABEL[key]}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-caption text-ink-muted">Seeing a portfolio never opens its projects: people see only the projects they already have access to.</p>
            </div>
            {privacy === "DEPARTMENT" && (
              <div>
                <label htmlFor={`${id}-dept`} className="field-label">
                  Department
                </label>
                <select id={`${id}-dept`} value={department} onChange={(event) => setDepartment(event.target.value ? Number(event.target.value) : "")} className="field-input" required>
                  <option value="">Choose…</option>
                  {departments.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
          <fieldset>
            <legend className="field-label">Opens on</legend>
            <div className="grid gap-2 sm:grid-cols-4">
              {TABS.map((item) => (
                <label key={item.key} className={`flex cursor-pointer flex-col gap-1 rounded-xl border p-3 text-label ${tab === item.key ? "border-primary-600 bg-primary-50 ring-1 ring-primary-600" : "border-line bg-surface hover:border-line-strong"}`}>
                  <input type="radio" name="tab" value={item.key} checked={tab === item.key} onChange={() => setTab(item.key)} className="sr-only" />
                  <item.icon aria-hidden="true" className="h-4 w-4" />
                  <span className="font-medium">{item.label}</span>
                  <span className="text-caption text-ink-muted">{item.hint}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <button type="submit" disabled={!name.trim()} className="btn-primary w-full sm:w-auto" data-testid="wizard-continue">
            Continue
          </button>
        </form>
      )}

      {step === 2 && (
        <div className="card space-y-4 p-5">
          <div>
            <h2 className="font-semibold">Add projects</h2>
            <p className="text-label text-ink-muted">Pick the projects (and portfolios) to follow here. Only those you can see are listed. You can add more later.</p>
          </div>
          <div>
            <label htmlFor={`${id}-q`} className="field-label">
              Find a project or portfolio
            </label>
            <input id={`${id}-q`} type="search" value={query} onChange={(event) => setQuery(event.target.value)} className="field-input" placeholder="Type a name…" data-testid="wizard-search" />
          </div>
          <fieldset>
            <legend className="mb-1 text-caption font-semibold text-ink-faint">Projects</legend>
            {shownProjects.length === 0 ? (
              <p className="text-label text-ink-muted">No projects match.</p>
            ) : (
              <ul className="max-h-72 space-y-1 overflow-y-auto">
                {shownProjects.map((item) => (
                  <li key={item.id}>
                    <label className="flex items-center gap-2 rounded-md px-2 py-1.5 text-label hover:bg-surface-muted">
                      <input type="checkbox" checked={chosenProjects.includes(item.id)} onChange={() => toggle(chosenProjects, setChosenProjects, item.id)} />
                      <ProjectDot color={item.color} />
                      {item.name}
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </fieldset>
          {shownPortfolios.length > 0 && (
            <fieldset>
              <legend className="mb-1 text-caption font-semibold text-ink-faint">Portfolios</legend>
              <ul className="max-h-48 space-y-1 overflow-y-auto">
                {shownPortfolios.map((item) => (
                  <li key={item.id}>
                    <label className="flex items-center gap-2 rounded-md px-2 py-1.5 text-label hover:bg-surface-muted">
                      <input type="checkbox" checked={chosenPortfolios.includes(item.id)} onChange={() => toggle(chosenPortfolios, setChosenPortfolios, item.id)} />
                      <ProjectDot color={item.color} />
                      {item.name} <span className="text-caption text-ink-muted">· {item.items} items</span>
                    </label>
                  </li>
                ))}
              </ul>
            </fieldset>
          )}
          <p className="text-caption text-ink-muted" aria-live="polite">
            {chosenProjects.length + chosenPortfolios.length} chosen
          </p>
          <button type="button" className="btn-primary" onClick={() => setStep(3)} data-testid="wizard-continue">
            Continue
          </button>
        </div>
      )}

      {step === 3 && (
        <div className="card space-y-4 p-5">
          <div>
            <h2 className="font-semibold">Add people</h2>
            <p className="text-label text-ink-muted">You are its owner. Add people now or later with Share; they are told by notification.</p>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-56 flex-1">
              <span className="field-label" id={`${id}-person`}>
                Person
              </span>
              <PersonSelect ariaLabel="Person to add" options={people.filter((person) => person.id !== meId && !members.some((member) => member.id === person.id))} value={who} onChange={setWho} placeholder="Choose a person…" testId="wizard-person" />
            </div>
            <div>
              <label htmlFor={`${id}-role`} className="field-label">
                Role
              </label>
              <select id={`${id}-role`} value={role} onChange={(event) => setRole(event.target.value as ProjectRole)} className="field-input">
                {(["OWNER", "EDITOR", "COMMENTER", "VIEWER"] as const).map((key) => (
                  <option key={key} value={key}>
                    {PROJECT_ROLE_LABEL[key]}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="button"
              className="btn-secondary"
              disabled={who === null}
              onClick={() => {
                if (who === null) return;
                setMembers([...members, { id: who, role }]);
                setWho(null);
              }}
              data-testid="wizard-add-person"
            >
              Add
            </button>
          </div>
          {members.length > 0 && (
            <ul className="divide-y divide-line rounded-md border border-line" aria-label="People to add">
              {members.map((member) => (
                <li key={member.id} className="flex items-center gap-2 px-3 py-2 text-label">
                  <span className="flex-1">{personName(member.id)}</span>
                  <span className="text-ink-muted">{PROJECT_ROLE_LABEL[member.role]}</span>
                  <button type="button" aria-label={`Remove ${personName(member.id)}`} className="rounded p-1 text-ink-muted hover:text-danger-600" onClick={() => setMembers(members.filter((item) => item.id !== member.id))}>
                    <X aria-hidden="true" className="h-4 w-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}
          {error && (
            <p role="alert" className="rounded-md bg-danger-50 px-3 py-2 text-label text-danger-600">
              {error}
            </p>
          )}
          <button type="button" className="btn-primary" disabled={busy || !name.trim()} aria-busy={busy || undefined} onClick={() => void create()} data-testid="wizard-create">
            {busy ? "Creating…" : "Create portfolio"}
          </button>
        </div>
      )}
    </div>
  );
}
