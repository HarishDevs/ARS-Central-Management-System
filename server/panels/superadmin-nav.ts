import type { NavItem } from "@/features/shell/SideNav";
import type { SettingDefinition } from "@/server/settings/definitions";

// v1.84.0 (D-411, owner's redesign, 23 Nov 2026): the Super Admin panel in
// five groups (docs/ops/ADMIN-REDESIGN-BRIEF.md). Sentence case everywhere.
export const SUPERADMIN_NAV: readonly NavItem[] = [
  { href: "/superadmin", label: "Health console", section: "Health" },
  // v1.94.0 (D-451): Super Admin full control: find, change, archive or bin any item; the one Deleted items bin.
  { href: "/superadmin/control", label: "Control panel", section: "Control" },
  { href: "/superadmin/control/bin", label: "Deleted items", section: "Control" },
  { href: "/superadmin/connections/email", label: "Email", section: "Connections" },
  { href: "/superadmin/connections/whatsapp", label: "WhatsApp", section: "Connections" },
  { href: "/superadmin/connections/push", label: "Phone & desktop notifications", section: "Connections" },
  { href: "/superadmin/connections/google", label: "Google sign-in & calendar", section: "Connections" },
  { href: "/superadmin/connections/salesforce", label: "Salesforce", section: "Connections" },
  { href: "/superadmin/connections/ai", label: "AI providers", section: "Connections" },
  { href: "/superadmin/security/sign-in", label: "Sign-in security", section: "Security & access" },
  { href: "/superadmin/security/general", label: "General", section: "Security & access" },
  { href: "/superadmin/security/pages", label: "Page access", section: "Security & access" },
  { href: "/superadmin/security/features", label: "Feature switches", section: "Security & access" },
  { href: "/superadmin/security/sign-in-history", label: "Sign-in history", section: "Security & access" },
  { href: "/superadmin/data/backup", label: "Backup, restore & migrate", section: "Data" },
  { href: "/superadmin/data/retention", label: "Retention & legal holds", section: "Data" },
  { href: "/superadmin/data/import", label: "Import data", section: "Data" },
  { href: "/superadmin/data/danger-zone", label: "Danger zone", section: "Data" },
  { href: "/superadmin/monitoring/audit", label: "Audit log", section: "Monitoring" },
  { href: "/superadmin/monitoring/deliveries", label: "Message deliveries", section: "Monitoring" },
  { href: "/superadmin/monitoring/jobs", label: "Job runner & automation", section: "Monitoring" },
  { href: "/superadmin/monitoring/ai-history", label: "AI activity history", section: "Monitoring" },
  { href: "/superadmin/monitoring/ai-reports", label: "AI reports", section: "Monitoring" },
];

// Pages that are reached from another page (not in the sidebar) but must
// still light their parent and be found by Search settings.
export const SUPERADMIN_SUBPAGES: readonly { href: string; label: string; parent: string }[] = [
  { href: "/superadmin/connections/whatsapp/templates", label: "WhatsApp templates", parent: "/superadmin/connections/whatsapp" },
  { href: "/superadmin/connections/ai/data-sources", label: "AI data sources", parent: "/superadmin/connections/ai" },
  { href: "/superadmin/data/danger-zone/requests", label: "Delete requests (bulk)", parent: "/superadmin/data/danger-zone" },
  { href: "/superadmin/data/danger-zone/demo", label: "Demo data", parent: "/superadmin/data/danger-zone" },
];

// Where each settings group is edited now (the old Providers & security page is gone).
export const SETTING_GROUP_PAGE: Record<SettingDefinition["group"], string> = {
  EMAIL: "/superadmin/connections/email",
  WHATSAPP: "/superadmin/connections/whatsapp",
  PUSH: "/superadmin/connections/push",
  AI: "/superadmin/connections/ai",
  AI_DATA: "/superadmin/connections/salesforce",
  AUTHENTICATION: "/superadmin/security/sign-in",
  GENERAL: "/superadmin/security/general",
  FEATURES: "/superadmin/security/features",
  BACKUP: "/superadmin/data/backup#settings-BACKUP",
  GDRIVE_BACKUP: "/superadmin/data/backup#settings-GDRIVE_BACKUP",
  RETENTION: "/superadmin/data/retention#settings-RETENTION",
};
