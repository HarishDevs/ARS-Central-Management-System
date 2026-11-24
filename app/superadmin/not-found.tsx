import { NOT_FOUND_BODY, NOT_FOUND_TITLE, StatePage } from "@/features/ui/StatePage";

// FB-07: the same page whether something doesn't exist or isn't yours to
// see, so it never confirms that a private request exists (D-016).
// v1.89.0 (D-422, UIQA-CON-16): the shared StatePage with the Super Admin home (it had the requests search before).
export default function NotFound() {
  return <StatePage kind="not-found" title={NOT_FOUND_TITLE} body={NOT_FOUND_BODY} home={{ href: "/superadmin", label: "Go to the Super Admin home" }} />;
}
