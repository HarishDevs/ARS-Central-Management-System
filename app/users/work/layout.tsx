import { WorkKeys } from "@/features/work/WorkKeys";
import { DateWordsProvider } from "@/features/ui/date-words";
import { workPage } from "@/server/work/page-context";

// D-215 / D-219: the Tasks area looks like Asana, with the area's keyboard.
// D-223 (owner): its pages sit in the sidebar's "Tasks & projects" group, so
// the page takes the full width (no second bar).
export default async function WorkLayout({ children }: { children: React.ReactNode }) {
  await workPage();
  return (
    <>
      <WorkKeys />
      {/* v1.95.0 (D-471): PM screens write dates, not weekday names. */}
      <DateWordsProvider weekdays={false}>{children}</DateWordsProvider>
    </>
  );
}
