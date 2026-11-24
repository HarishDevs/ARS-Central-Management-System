import { NOT_FOUND_BODY, NOT_FOUND_TITLE, StatePage } from "@/features/ui/StatePage";

// FB-07: the same page whether something doesn't exist or isn't yours to
// see, so it never confirms that a private request exists (D-016).
// v1.89.0 (D-422, UIQA-CON-16): the shared StatePage with the app's search (requests, tasks and the rest) and Home.
export default function NotFound() {
  return <StatePage kind="not-found" title={NOT_FOUND_TITLE} body={NOT_FOUND_BODY} search={{ action: "/users/search", label: "Search the app", placeholder: "Search by number or title" }} home={{ href: "/users", label: "Go to Home" }} />;
}
