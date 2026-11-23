import type { Metadata } from "next";
import { MeetingRecords } from "@/features/admin/TicketMeetingRecords";
import { requireArea } from "@/server/authorization/guards";

export const metadata: Metadata = { title: "Records: Meetings" };
export const dynamic = "force-dynamic";

// v1.85.0 (D-412, owner): every meeting record, whoever raised it (Admin area).
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireArea("admin");
  return <MeetingRecords query={await searchParams} />;
}
