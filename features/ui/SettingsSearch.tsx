"use client";

import Link from "next/link";
import { Search, X } from "lucide-react";
import { useId, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

// v1.84.0 (D-411, owner's redesign): Search settings across both panels.
// The server builds the index for the person (server/panels/settings-index):
// only pages and settings they may open are in it, so nothing they can't
// open is ever found. Up and Down move through the results; Enter opens one.
export interface SettingsIndexEntry {
  label: string;
  href: string;
  // "Super Admin → Connections" or "Admin → Set-up".
  place: string;
  keywords?: string;
}

export function searchIndex(index: readonly SettingsIndexEntry[], query: string, limit = 8): SettingsIndexEntry[] {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  const scored = index
    .map((entry) => {
      const label = entry.label.toLowerCase();
      const hay = `${label} ${entry.place.toLowerCase()} ${(entry.keywords ?? "").toLowerCase()}`;
      if (!terms.every((term) => hay.includes(term))) return null;
      const score = terms.reduce((sum, term) => sum + (label.startsWith(term) ? 3 : label.includes(term) ? 2 : 0), 0);
      return { entry, score };
    })
    .filter((item): item is { entry: SettingsIndexEntry; score: number } => item !== null)
    .sort((a, b) => b.score - a.score || a.entry.label.localeCompare(b.entry.label));
  const seen = new Set<string>();
  const out: SettingsIndexEntry[] = [];
  for (const { entry } of scored) {
    const key = `${entry.href}|${entry.label}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(entry);
    if (out.length >= limit) break;
  }
  return out;
}

export function SettingsSearch({ index, compact = false }: { index: readonly SettingsIndexEntry[]; compact?: boolean }) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const id = useId();
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const results = useMemo(() => searchIndex(index, query), [index, query]);
  const open = query.trim().length > 0;
  const go = (entry: SettingsIndexEntry) => {
    setQuery("");
    router.push(entry.href);
  };
  return (
    <div className={`relative ${compact ? "" : "mb-4"}`} data-testid="settings-search">
      <label htmlFor={id} className="sr-only">
        Search settings
      </label>
      <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-ink-faint" />
      <input
        ref={input}
        id={id}
        type="search"
        data-search-kind="finder"
        role="combobox"
        aria-expanded={open && results.length > 0}
        aria-controls={open && results.length > 0 ? `${id}-list` : undefined}
        aria-autocomplete="list"
        aria-activedescendant={open && results[active] ? `${id}-opt-${active}` : undefined}
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setActive(0);
        }}
        onKeyDown={(event) => {
          if (!open) return;
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setActive((current) => Math.min(results.length - 1, current + 1));
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setActive((current) => Math.max(0, current - 1));
          } else if (event.key === "Enter" && results[active]) {
            event.preventDefault();
            go(results[active]);
          } else if (event.key === "Escape") {
            event.preventDefault();
            setQuery("");
          }
        }}
        placeholder="Search settings"
        className="field-input field-compact pl-9 pr-8"
        autoComplete="off"
      />
      {query && (
        <button type="button" aria-label="Clear search" onClick={() => { setQuery(""); input.current?.focus(); }} className="absolute right-1 top-1 grid h-7 w-7 place-items-center rounded text-ink-muted hover:bg-surface-muted">
          <X aria-hidden="true" className="h-3.5 w-3.5" />
        </button>
      )}
      {open && (
        <div className="absolute left-0 right-0 z-popover mt-1 max-h-80 overflow-y-auto rounded-md border border-line bg-surface shadow-overlay">
          {results.length === 0 ? (
            <p role="status" className="px-3 py-2 text-label text-ink-muted">
              No setting matches “{query}”.
            </p>
          ) : (
            <ul id={`${id}-list`} role="listbox" aria-label="Matching settings" className="py-1">
              {results.map((entry, index) => (
                <li key={`${entry.href}|${entry.label}`} id={`${id}-opt-${index}`} role="option" aria-selected={index === active}>
                  <Link
                    href={entry.href}
                    tabIndex={-1}
                    onClick={() => setQuery("")}
                    onMouseEnter={() => setActive(index)}
                    className={`block px-3 py-1.5 text-label ${index === active ? "bg-primary-50 text-primary-700" : "text-ink hover:bg-surface-muted"}`}
                    data-testid="settings-search-result"
                  >
                    <span className="block font-medium">{entry.label}</span>
                    <span className="block text-caption text-ink-muted">{entry.place}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
