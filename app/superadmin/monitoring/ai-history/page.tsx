import type { Metadata } from "next";
import { PageHeader } from "@/features/shell/PageHeader";
import { EmptyState } from "@/features/ui/Display";
import { listAllConversations } from "@/lib/db/repositories/ai.repository";
import { MODE_LABEL, type ChatMode } from "@/server/ai/chat-access";
import { formatIndiaTime } from "@/server/notifications/security-messages";
import { requireArea } from "@/server/authorization/guards";
import { ListToolbar } from "@/features/ui/ListToolbar";
import { FoldScope, FoldTbody } from "@/features/ui/GroupFold";
import { ListViews } from "@/features/lists/ListViews";
import { groupMenu, sortHeads } from "@/features/superadmin/sort-heads";
import { applyDefaultListView } from "@/server/lists/views";
import { LatestNote } from "@/features/ui/LatestNote";
import { latestLimit } from "@/features/shell/nav-routes";
import { parseColumnSort, sortRows } from "@/server/lists/sorting";
import { groupRows, pickGroup } from "@/server/lists/group-rows";
import { AI_HISTORY_COLUMNS, AI_HISTORY_GROUP_LABEL, AI_HISTORY_GROUPS, aiHistoryBucket, type AiHistoryColumn } from "@/server/lists/superadmin-lists";

export const metadata: Metadata = { title: "AI activity history" };
export const dynamic = "force-dynamic";

const PATH = "/superadmin/monitoring/ai-history";
const TARGET = "list_super_ai_history";

// D-180 (owner): everyone's AI conversations, newest first, for the Super
// Admin (layout). Titles and counts only; the messages stay their owner's.
export default async function AiActivityHistoryPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  // D-244 (audit SEC-02): every page checks its own area. The layout's
  // check alone isn't enough: a client-navigation request (RSC) renders the
  // page without waiting for the layout.
  const { user } = await requireArea("superadmin");
  const query = await searchParams;
  // v1.58.0 (D-354, owner): the person's default saved view when nothing is chosen.
  await applyDefaultListView(user.id, TARGET, PATH, query);
  // v1.72.1 (D-395, QA F-07): the latest 200, and "Show 200 more" up to 1,000.
  const limit = latestLimit(query.limit, 200, 1000);
  const latest = await listAllConversations(limit);
  const chatLabel = (mode: string) => MODE_LABEL[mode as ChatMode] ?? "Earlier version";
  // v1.58.0 (D-354, owner: "sorting in all the tables ... in all columns"): the latest 200, sorted by any column.
  const sort = parseColumnSort(query, AI_HISTORY_COLUMNS);
  const value: Record<AiHistoryColumn, (conversation: (typeof latest)[number]) => unknown> = {
    person: (conversation) => conversation.ownerName,
    conversation: (conversation) => conversation.title,
    chat: (conversation) => chatLabel(conversation.mode),
    messages: (conversation) => conversation.messageCount,
    last: (conversation) => conversation.updatedAt,
  };
  const conversations = sort.sortBy ? sortRows(latest, value[sort.sortBy], sort.dir) : latest;
  // v1.58.0 (D-354, owner): Group by person, chat or day (folded by default).
  const group = pickGroup(query.group, AI_HISTORY_GROUPS);
  const head = sortHeads(PATH, query, sort);
  const rowOf = (conversation: (typeof conversations)[number]) => (
    <tr key={conversation.id}>
      <td className="font-medium">{conversation.ownerName}</td>
      <td className="max-w-md break-words">{conversation.title}</td>
      <td className="text-label">{chatLabel(conversation.mode)}</td>
      <td>{conversation.messageCount}</td>
      <td className="text-label text-ink-muted">{formatIndiaTime(conversation.updatedAt)}</td>
    </tr>
  );
  return (
    <>
      <PageHeader title="AI activity history" description="Everyone's Pico Bot conversations, newest first: who, what about, when. The messages themselves stay private to each person." />
      {conversations.length === 0 ? (
        <EmptyState title="No conversations yet" body="Conversations appear here once people use Pico Bot." />
      ) : (
        <>
          <ListToolbar id="ai-history" path={PATH} label="AI conversations" keep={{}} filterCount={0} clearHref={null} group={groupMenu(PATH, query, group, AI_HISTORY_GROUPS, AI_HISTORY_GROUP_LABEL)} />
          <ListViews userId={user.id} target={TARGET} path={PATH} query={query} />
          <FoldScope enabled={Boolean(group)}>
            <div className="card overflow-x-auto">
              <table className="data-table" data-testid="ai-history">
                <thead>
                  <tr>
                    {head("Person", "person")}
                    {head("Conversation", "conversation")}
                    {head("Chat", "chat")}
                    {head("Messages", "messages")}
                    {head("Last activity", "last")}
                  </tr>
                </thead>
                {group ? (
                  groupRows(conversations, (conversation) => aiHistoryBucket(group, { ownerName: conversation.ownerName, chatLabel: chatLabel(conversation.mode), updatedAt: conversation.updatedAt })).map((section) => (
                    <FoldTbody key={section.key} label={section.label} count={section.items.length} colSpan={5}>
                      {section.items.map(rowOf)}
                    </FoldTbody>
                  ))
                ) : (
                  <tbody>{conversations.map(rowOf)}</tbody>
                )}
              </table>
            </div>
          </FoldScope>
          <LatestNote shown={latest.length} limit={limit} step={200} max={1000} path={PATH} query={query} what="conversations" />
        </>
      )}
    </>
  );
}
