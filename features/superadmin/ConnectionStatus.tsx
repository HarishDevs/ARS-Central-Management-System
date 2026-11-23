import { StatusCard } from "@/features/ui/StatusCard";
import { HealthTestButton } from "@/features/superadmin/HealthTest";
import { loadHealthCards, type HealthKey } from "@/server/panels/health";

// v1.84.0 (D-411): a Connections page opens with its status (the same card
// as the Health console), so status, settings and Test sit together.
export async function ConnectionStatus({ keys }: { keys: HealthKey[] }) {
  const cards = (await loadHealthCards()).filter((card) => keys.includes(card.key));
  return (
    <div className={`mb-6 grid gap-4 ${cards.length > 1 ? "md:grid-cols-2" : ""}`}>
      {cards.map((card) => (
        <StatusCard key={card.key} testId={`status-${card.key}`} title={card.title} health={card.health} detail={card.action ? `${card.detail} ${card.action}` : card.detail} checked={card.checked} test={card.test ? <HealthTestButton test={card.test} title={card.title} /> : undefined} />
      ))}
    </div>
  );
}
