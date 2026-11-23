import { Briefcase, Ticket, TicketPlus, Tags, LayoutDashboard as TicketBoard, Columns3 as CoordinatorBoard, AlarmClock, FolderPlus, BookOpenCheck, ChartNoAxesCombined, Sheet, Cloud, AlertTriangle, Plug, CheckCheck, ChartLine, Archive, FileBarChart, BarChart3, Bot, BellRing, Building2, CalendarDays, ClipboardCheck, FileClock, FilePlus2, FileSearch, FileText, Gauge, HelpCircle, History, CalendarOff, Home, Inbox, KeyRound, LayoutDashboard, ListChecks, MessageSquareText, Scale, Send, Settings, ShieldCheck, Upload, User, UserCog, Users, UsersRound, ListTodo, ClipboardList, Megaphone, MailPlus, Network, Newspaper, Sparkles, MessagesSquare, Database, DatabaseBackup, FileChartColumn, Folder, Files, RefreshCw, Layers, FilePenLine, FileCheck2, CalendarClock, CalendarPlus, CalendarCog, type LucideIcon, Undo2, Activity, Mail, MessageCircle, Smartphone, Lock, ToggleRight, AlertOctagon, ScrollText } from "lucide-react";

// UI-04: one icon per navigation entry. The label always stays beside it.
const ICONS: Record<string, LucideIcon> = {
  "/users": Home,
  "/users/queue": Inbox,
  "/users/requests": FileText,
  "/users/new": Files,
  "/users/custom": FilePlus2,
  "/users/search": FileSearch,
  "/users/calendar": CalendarDays,
  "/users/collaborating": UsersRound,
  "/users/approved": FileCheck2,
  "/users/approved-by-me": CheckCheck,
  "/users/queue/sent-back": Undo2, // v1.59.1
  "/users/help": HelpCircle,
  "/users/profile": User,
  // v1.9.0: Task and Information modules
  "/users/tasks": ListTodo,
  "/users/tasks/assigned": Send,
  "/users/tasks/team": Network,
  "/users/tasks/new": FilePenLine,
  // D-215: Task & Project Management
  "/users/work": Home,
  "/users/work/my-tasks": ListChecks,
  "/users/work/projects": Folder,
  "/users/work/search": FileSearch,
  "/users/work/periodic": RefreshCw,
  "/users/work/inbox": Inbox,
  "/users/inbox": Inbox,
  "/users/work/projects/new": FolderPlus,
  "/users/work/projects?show=templates": Layers,
  "/users/work/templates": Layers, // v1.70.0 gallery (v1.72.1: had no icon)
  "/users/work/portfolios": Briefcase, // v1.69.0 (D-382)
  "/users/information": FileText,
  "/users/information/sent": Send,
  "/users/information/new": MailPlus,
  // v1.55.0 (D-326): the Ticketing System.
  "/users/tickets/new": TicketPlus,
  "/users/tickets": Ticket,
  "/users/tickets/board": CoordinatorBoard, // v1.57.1 (D-337)
  "/users/tickets/dashboards": TicketBoard,
  // v1.51.0 (D-300): Meeting Management
  "/users/meetings": CalendarClock,
  "/users/meetings/new": CalendarPlus,
  "/users/meetings/follow-ups": ListChecks,
  "/users/meetings/dashboard": BarChart3,
  "/admin/meetings": CalendarCog,
  // D-168: the AI module
  "/users/ai": Sparkles,
  "/users/ai/assistant": MessagesSquare,
  "/superadmin/connections/ai": Sparkles,
  "/admin/ai-rules": BookOpenCheck,
  "/admin/reminders": AlarmClock,
  "/admin/ai-analytics": ChartNoAxesCombined,
  "/admin/records/requests": Sheet,
  "/admin/records/tasks": ListTodo,
  "/admin/records/information": Newspaper,
  "/superadmin/connections/salesforce": Cloud,
  // D-180: AI Details (Super Admin)
  "/superadmin/connections/ai/data-sources": Database,
  "/superadmin/monitoring/ai-reports": FileChartColumn,
  "/superadmin/monitoring/ai-history": History,
  "/admin/task-types": ClipboardList,
  "/admin/task-holidays": CalendarOff,
  "/admin/information-types": Megaphone,
  "/admin/ticket-forms": Ticket,
  "/admin/ticket-categories": Tags,
  "/admin": LayoutDashboard,
  "/admin/insights": BarChart3,
  "/admin/dashboards": Gauge,
  "/admin/analytics": ChartLine,
  "/admin/workload": ClipboardCheck,
  "/admin/workload/reassign": Send, // v1.72.1 (D-395): was the old /admin/reassign address
  "/admin/groups": Users,
  "/admin/doa": Scale,
  "/admin/budgets": Building2,
  "/admin/attention": AlertTriangle,
  "/users/analytics": BarChart3,
  "/users/reports": FileBarChart,
  "/users/analytics?scope=ORGANISATION": ChartLine,
  "/admin/reports": FileBarChart,
  "/admin/custom-approval": ListChecks,
  "/superadmin/security/pages": ShieldCheck,
  "/admin/calendar": CalendarDays,
  "/admin/users": UserCog,
  "/admin/organisation": Building2,
  "/admin/import": Upload,
  "/superadmin": Activity, // v1.84.0 (D-411): the Health console
  "/superadmin/connections/email": Mail,
  "/superadmin/connections/whatsapp": MessageCircle,
  "/superadmin/connections/push": Smartphone,
  "/superadmin/security/sign-in": Lock,
  "/superadmin/security/general": Settings,
  "/superadmin/security/features": ToggleRight,
  "/superadmin/data/danger-zone": AlertOctagon,
  "/superadmin/connections/google": Plug,
  "/superadmin/connections/whatsapp/templates": MessageSquareText,
  "/superadmin/data/danger-zone/requests": FileClock,
  "/superadmin/data/import": Upload,
  "/superadmin/data/danger-zone/demo": Users,
  "/superadmin/monitoring/deliveries": BellRing,
  "/superadmin/monitoring/jobs": Bot,
  "/superadmin/data/retention": Archive,
  "/superadmin/data/backup": DatabaseBackup,
  "/superadmin/monitoring/audit": ScrollText,
  "/superadmin/security/sign-in-history": KeyRound,
};

// v1.9.2: the collapsible groups of the user sidebar.
const SECTION_ICONS: Record<string, LucideIcon> = { "My Approvals": ClipboardCheck, Tasks: ListTodo, "Tasks & projects": ListTodo, Information: Newspaper, Meetings: CalendarClock, Tickets: Ticket, AI: Sparkles, "AI Assistant": MessagesSquare, "AI Details": Sparkles };

export function SectionIcon({ section, className = "h-4 w-4" }: { section: string; className?: string }) {
  const Icon = SECTION_ICONS[section];
  return Icon ? <Icon aria-hidden="true" className={`shrink-0 ${className}`} /> : null;
}

// v1.42.0 brand: the entry icons are ARS Blue (nav-icon, globals.css).
export function NavIcon({ href, className = "h-4 w-4" }: { href: string; className?: string }) {
  const Icon = ICONS[href];
  return Icon ? <Icon aria-hidden="true" strokeWidth={1.9} className={`nav-icon shrink-0 ${className}`} /> : null;
}
