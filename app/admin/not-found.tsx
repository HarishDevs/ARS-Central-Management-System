import { NOT_FOUND_BODY, NOT_FOUND_TITLE, StatePage } from "@/features/ui/StatePage";

// FB-07: the same page whether something doesn't exist or isn't yours to
// see, so it never confirms that a private request exists (D-016).
// v1.89.0 (D-422, UIQA-CON-16): the shared StatePage with the Admin home (Admin has no record search box; it was the requests search before).
export default function NotFound() {
  return <StatePage kind="not-found" title={NOT_FOUND_TITLE} body={NOT_FOUND_BODY} home={{ href: "/admin", label: "Go to the Admin home" }} />;
}
