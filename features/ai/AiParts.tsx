import Link from "next/link";

export function ProviderNotice({ isSuperAdmin }: { isSuperAdmin: boolean }) {
  return (
    <p className="text-label text-ink-muted">
      No AI provider is set up yet.{" "}
      {isSuperAdmin ? (
        <Link href="/superadmin/connections/ai" className="link">
          Set one up in AI providers
        </Link>
      ) : (
        "The Super Admin sets one up in AI providers."
      )}
    </p>
  );
}
