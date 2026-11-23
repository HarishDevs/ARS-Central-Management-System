import type { Metadata } from "next";
import { TicketRecords } from "@/features/admin/TicketMeetingRecords";
import { requireArea } from "@/server/authorization/guards";

export const metadata: Metadata = { title: "Records: Tickets" };
export const dynamic = "force-dynamic";

// v1.85.0 (D-412, owner): every ticket record, whoever raised it (Admin area).
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireArea("admin");
  return <TicketRecords query={await searchParams} />;
}
