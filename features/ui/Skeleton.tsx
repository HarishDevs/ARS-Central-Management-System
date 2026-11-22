import { SkeletonBlock } from "@/features/ui/Spinner";

// FB-01 loading skeletons that match each page's layout, so nothing jumps
// when the content arrives. Screen readers hear one "Loading…" line.
export { SkeletonBlock };

function Announce({ label }: { label: string }) {
  return (
    <p role="status" className="sr-only">
      {label}
    </p>
  );
}

export function HeaderSkeleton({ actions = false }: { actions?: boolean }) {
  return (
    <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div className="space-y-2">
        <SkeletonBlock className="h-7 w-56" />
        <SkeletonBlock className="h-4 w-80 max-w-[70vw]" />
      </div>
      {actions && <SkeletonBlock className="h-9 w-32" />}
    </div>
  );
}

export function TilesSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="card flex items-center gap-3 p-4">
          <SkeletonBlock className="h-11 w-11 shrink-0 rounded-xl" />
          <div className="min-w-0 flex-1 space-y-2">
            <SkeletonBlock className="h-4 w-24" />
            <SkeletonBlock className="h-3 w-16" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function ListSkeleton({ rows = 5, title = true }: { rows?: number; title?: boolean }) {
  return (
    <div className="card">
      {title && (
        <div className="border-b border-line px-5 py-4">
          <SkeletonBlock className="h-5 w-40" />
        </div>
      )}
      <ul className="divide-y divide-line">
        {Array.from({ length: rows }, (_, index) => (
          <li key={index} className="flex items-center gap-4 px-5 py-4">
            <SkeletonBlock className="h-9 w-9 shrink-0 rounded-lg" />
            <div className="min-w-0 flex-1 space-y-2">
              <SkeletonBlock className="h-4 w-2/3" />
              <SkeletonBlock className="h-3 w-1/3" />
            </div>
            <SkeletonBlock className="hidden h-6 w-20 sm:block" />
          </li>
        ))}
      </ul>
    </div>
  );
}

export function TableSkeleton({ rows = 6, columns = 5 }: { rows?: number; columns?: number }) {
  return (
    <div className="card overflow-hidden">
      <div className="grid gap-4 border-b border-line px-4 py-3" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
        {Array.from({ length: columns }, (_, index) => (
          <SkeletonBlock key={index} className="h-3 w-2/3" />
        ))}
      </div>
      {Array.from({ length: rows }, (_, row) => (
        <div key={row} className="grid gap-4 border-b border-line px-4 py-3.5 last:border-b-0" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
          {Array.from({ length: columns }, (_, index) => (
            <SkeletonBlock key={index} className={`h-4 ${index === 0 ? "w-4/5" : "w-1/2"}`} />
          ))}
        </div>
      ))}
    </div>
  );
}

// Bars rising from a baseline, while a chart's numbers load (Analytics).
export function ChartSkeleton({ bars = 7 }: { bars?: number }) {
  return (
    <div className="card p-5" data-testid="chart-skeleton">
      <SkeletonBlock className="mb-4 h-4 w-40" />
      <div className="flex h-40 items-end gap-3 border-b border-line">
        {Array.from({ length: bars }, (_, index) => (
          <SkeletonBlock key={index} className="flex-1 rounded-b-none" style={{ height: `${35 + ((index * 37) % 60)}%` }} />
        ))}
      </div>
    </div>
  );
}

export function FormSkeleton({ fields = 5 }: { fields?: number }) {
  return (
    <div className="card max-w-3xl space-y-5 p-5">
      {Array.from({ length: fields }, (_, index) => (
        <div key={index} className="space-y-2">
          <SkeletonBlock className="h-4 w-32" />
          <SkeletonBlock className="h-11 w-full" />
        </div>
      ))}
      <SkeletonBlock className="h-11 w-40" />
    </div>
  );
}

// Whole-page skeletons used by loading.tsx files.
export function PageSkeleton({ kind = "list", label = "Loading…" }: { kind?: "list" | "dashboard" | "table" | "detail" | "form"; label?: string }) {
  return (
    <div aria-busy="true">
      <Announce label={label} />
      <HeaderSkeleton actions={kind !== "detail"} />
      {kind === "dashboard" && (
        <>
          <TilesSkeleton />
          <div className="grid gap-6 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
            <ListSkeleton rows={4} />
            <ChartSkeleton />
          </div>
        </>
      )}
      {kind === "list" && <ListSkeleton rows={6} />}
      {kind === "table" && <TableSkeleton />}
      {kind === "form" && <FormSkeleton />}
      {kind === "detail" && (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
          <div className="space-y-6">
            <div className="card space-y-3 p-5">
              <SkeletonBlock className="h-5 w-40" />
              <SkeletonBlock className="h-16 w-full" />
              <SkeletonBlock className="h-16 w-full" />
            </div>
            <FormSkeleton fields={3} />
          </div>
          <ListSkeleton rows={5} />
        </div>
      )}
    </div>
  );
}

// v1.72.0 (D-387, COMPONENT_SPECS §8, PV §2.5): a project page while it loads,
// shaped like the real one: the header row (tile, name, ▾, star, status;
// avatars, Share, Customize), the tabs strip, the toolbar (Add task │▾ on the
// left; Filter, Sort, Group, Options, Search on the right), then the List's
// column header, a section heading and task rows (circle, name, columns).
// The sweep stops under prefers-reduced-motion (.skeleton in globals.css).
export function ProjectSkeleton({ label = "Loading the project…" }: { label?: string }) {
  return (
    <div aria-busy="true" data-testid="project-skeleton">
      <Announce label={label} />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <SkeletonBlock className="h-7 w-7 shrink-0" />
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <SkeletonBlock className="h-6 w-48" />
            <SkeletonBlock className="h-4 w-4" />
            <SkeletonBlock className="h-4 w-4" />
            <SkeletonBlock className="h-5 w-20 rounded-full" />
          </div>
          <SkeletonBlock className="h-3 w-64 max-w-[60vw]" />
        </div>
        <div className="ml-auto hidden items-center gap-2 sm:flex">
          <SkeletonBlock className="h-7 w-7 rounded-full" />
          <SkeletonBlock className="h-7 w-7 rounded-full" />
          <SkeletonBlock className="h-8 w-20" />
          <SkeletonBlock className="h-8 w-24" />
        </div>
      </div>
      <div className="mb-3 flex items-end gap-5 border-b border-line pb-2">
        {[64, 36, 44, 56, 60].map((width, index) => (
          <SkeletonBlock key={index} className="h-4" style={{ width }} />
        ))}
        <SkeletonBlock className="h-4 w-16" />
      </div>
      <div className="mb-2 flex items-center gap-2">
        <SkeletonBlock className="h-8 w-28" />
        <div className="ml-auto flex items-center gap-3">
          {[48, 40, 48, 60].map((width, index) => (
            <SkeletonBlock key={index} className="h-4" style={{ width }} />
          ))}
          <SkeletonBlock className="h-4 w-4" />
        </div>
      </div>
      <div className="overflow-hidden rounded-lg border border-line bg-surface">
        <div className="grid grid-cols-[40px_minmax(0,1fr)_repeat(3,minmax(0,140px))] gap-3 border-b border-line px-2 py-2.5 max-sm:grid-cols-[40px_minmax(0,1fr)]">
          <SkeletonBlock className="h-3 w-3" />
          <SkeletonBlock className="h-3 w-16" />
          {[0, 1, 2].map((index) => (
            <SkeletonBlock key={index} className="h-3 w-16 max-sm:hidden" />
          ))}
        </div>
        {[0, 1].map((section) => (
          <div key={section}>
            <div className="flex items-center gap-2 border-b border-line px-2 pb-2 pt-5">
              <SkeletonBlock className="h-4 w-4" />
              <SkeletonBlock className="h-4 w-28" />
              <SkeletonBlock className="h-4 w-6 rounded-full" />
            </div>
            {Array.from({ length: section === 0 ? 4 : 2 }, (_, row) => (
              <div key={row} className="grid min-h-row grid-cols-[40px_minmax(0,1fr)_repeat(3,minmax(0,140px))] items-center gap-3 border-b border-line px-2 max-sm:grid-cols-[40px_minmax(0,1fr)]">
                <SkeletonBlock className="h-3 w-3" />
                <div className="flex items-center gap-2">
                  <SkeletonBlock className="h-4 w-4 shrink-0 rounded-full" />
                  <SkeletonBlock className="h-4" style={{ width: `${45 + ((row * 23 + section * 11) % 40)}%` }} />
                </div>
                {[0, 1, 2].map((column) => (
                  <SkeletonBlock key={column} className="h-4 w-20 max-sm:hidden" />
                ))}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

// v1.72.0 (D-387): the project settings page while it loads: the section list
// beside one column of cards.
export function ProjectSettingsSkeleton() {
  return (
    <div aria-busy="true" data-testid="settings-skeleton">
      <Announce label="Loading the project's settings…" />
      <HeaderSkeleton />
      <div className="grid gap-6 lg:grid-cols-[200px_minmax(0,1fr)]">
        <div className="hidden space-y-2 lg:block">
          {[80, 110, 90, 70, 100, 84, 96].map((width, index) => (
            <SkeletonBlock key={index} className="h-4" style={{ width }} />
          ))}
        </div>
        <div className="max-w-4xl space-y-6">
          <FormSkeleton fields={4} />
          <ListSkeleton rows={3} />
        </div>
      </div>
    </div>
  );
}
