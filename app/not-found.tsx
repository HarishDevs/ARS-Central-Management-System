import { NOT_FOUND_BODY, NOT_FOUND_TITLE, StatePage } from "@/features/ui/StatePage";

// Also shown for /admin and /superadmin when the user lacks the role, so
// those areas don't confirm they exist (D-016).
// v1.89.0 (D-422): the shared StatePage (the "404" caption is gone; the same
// words as every area's not-found page).
export default function NotFound() {
  return (
    <main className="flex min-h-full flex-col justify-center">
      <StatePage kind="not-found" title={NOT_FOUND_TITLE} body={NOT_FOUND_BODY} home={{ href: "/users", label: "Go to Home" }} />
    </main>
  );
}
