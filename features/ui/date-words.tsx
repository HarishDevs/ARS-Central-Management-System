"use client";

import { createContext, useContext } from "react";

// v1.95.0 (D-471, owner 28 Nov 2026, scoped to Project Management): inside the
// PM / work screens a day near today is written as the date itself ("27 Nov"),
// never a weekday name ("Friday"); only Yesterday, Today and Tomorrow stay as
// words. The rest of the app keeps the shared formatter's default (weekday names
// within the coming week) until the app-wide rollout (TD-041).
const DateWords = createContext<{ weekdays: boolean }>({ weekdays: true });

export function DateWordsProvider({ weekdays, children }: { weekdays: boolean; children: React.ReactNode }) {
  return <DateWords.Provider value={{ weekdays }}>{children}</DateWords.Provider>;
}

/** Whether day texts here may use weekday names (false inside PM screens). */
export const useDateWords = () => useContext(DateWords);
