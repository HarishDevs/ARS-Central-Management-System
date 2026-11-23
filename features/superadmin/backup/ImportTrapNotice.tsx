import Link from "next/link";
import { TriangleAlert } from "lucide-react";

// D-408 (owner brief, "Must also fix"): on 22 Nov 2026 the live database was
// emptied twice because GoDaddy's Database Manager → Import drops every table
// before it imports. Said wherever backups are, pointing to the centre.
export function ImportTrapNotice({ withLink = false }: { withLink?: boolean }) {
  return (
    <div role="note" aria-label="Warning about GoDaddy Database Manager Import" className="mt-4 flex gap-3 rounded-md border border-line bg-warning-50 px-4 py-3 text-label text-warning-600">
      <TriangleAlert aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0" />
      <p>
        <strong>Never use GoDaddy&apos;s Database Manager → Import</strong> to put data back or to move it: it deletes every table in the database first, even when the file holds only part of the data (this emptied the live database twice on 22 Nov 2026).{" "}
        {withLink ? (
          <>
            Use{" "}
            <Link className="link font-medium" href="/superadmin/data/backup">
              Backup, restore &amp; migrate
            </Link>{" "}
            instead: it checks the package first, makes a safety snapshot and can undo a failed restore.
          </>
        ) : (
          "Use this page instead: it checks the package first, makes a safety snapshot and can undo a failed restore."
        )}
      </p>
    </div>
  );
}
