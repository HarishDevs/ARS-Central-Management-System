import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/features/shell/PageHeader";
import { requireArea } from "@/server/authorization/guards";
import { DangerZone } from "@/features/ui/DangerZone";
import { BULK_DELETE_WORD } from "@/features/superadmin/danger-words";
import { DEMO_CONFIRM_WORD } from "@/server/demo/demo-data";

export const metadata: Metadata = { title: "Danger zone" };
export const dynamic = "force-dynamic";

// v1.84.0 (D-411, owner's redesign): Data → Danger zone. The two actions
// that remove or replace data in bulk (deleting requests, loading demo
// data) left the everyday pages and sit here, each in a red-edged box that
// says what it does; each asks for a typed word before it runs, checked on
// the server too. Super Admin only.
export default async function DangerZonePage() {
  await requireArea("superadmin");
  return (
    <>
      <PageHeader title="Danger zone" description="Actions that delete or replace data in bulk. Each one says what it does and asks you to type a word before it runs. Everything is recorded in the audit log." />
      <div className="space-y-6" data-testid="danger-zone">
        <DangerZone
          testId="danger-requests"
          title="Delete requests"
          what={
            <>
              Find any request and delete it, one by one or ticked in bulk (up to 100 at a time), with a reason. A deleted request disappears from every screen, queue and dashboard and its pending approvals are cancelled; the audit log keeps the record. Requests under a legal hold are skipped. There is no undo. Bulk delete asks you to type <strong>{BULK_DELETE_WORD}</strong>.
            </>
          }
        >
          <Link href="/superadmin/data/danger-zone/requests" className="btn-secondary btn-compact">
            Open delete requests
          </Link>
        </DangerZone>
        <DangerZone
          testId="danger-demo"
          title="Demo data"
          what={
            <>
              Load stand-in staff (20 demo people in 7 departments), approver groups and 12 published approval types, so the whole app can be tried; then retire them. Loading writes into this database (safe to press twice: what exists is left alone). It asks you to type <strong>{DEMO_CONFIRM_WORD}</strong>.
            </>
          }
        >
          <Link href="/superadmin/data/danger-zone/demo" className="btn-secondary btn-compact">
            Open demo data
          </Link>
        </DangerZone>
      </div>
    </>
  );
}
