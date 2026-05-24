"use client";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Database,
  FolderSync,
  Calendar,
  Merge,
  Cog,
  Bell,
  Map,
  Search,
  MessageSquare,
  Star,
  Brain,
  Users,
  FileText,
  FlaskConical,
  BellRing,
  Send,
  ShipWheel,
  CalendarClock,
  BarChart3,
  Target,
  Activity,
} from "lucide-react";

type Props = {
  variant?: "desktop" | "mobile";
  collapsed?: boolean;
  onNavigate?: () => void;
};

type NavItem = {
  href: string;
  label: string;
  icon: React.ReactNode;
};

type NavGroup = {
  title: string;
  items: NavItem[];
};

const NAV_GROUPS: NavGroup[] = [
  {
    title: "Overview",
    items: [
      { href: "/dashboard", label: "Dashboard", icon: <LayoutDashboard className="h-4 w-4" /> },
    ],
  },
  {
    title: "Data Management",
    items: [
      { href: "/datasources", label: "Datasources", icon: <Database className="h-4 w-4" /> },
      { href: "/cache", label: "Preview Cache", icon: <FolderSync className="h-4 w-4" /> },
      { href: "/period", label: "Period Map", icon: <Calendar className="h-4 w-4" /> },
      { href: "/merge", label: "Merge & Save", icon: <Merge className="h-4 w-4" /> },
    ],
  },
  {
    title: "Automation",
    items: [
      { href: "/automation", label: "Metabase Sync", icon: <Cog className="h-4 w-4" /> },
      { href: "/automation-notifications", label: "Notifikasi", icon: <Bell className="h-4 w-4" /> },
      { href: "/notifications-control", label: "Notif Controls", icon: <BellRing className="h-4 w-4" /> },
      { href: "/push-subscribers", label: "Push Subscribers", icon: <Send className="h-4 w-4" /> },
    ],
  },
  {
    title: "Tools",
    items: [
      { href: "/geojson", label: "GeoJSON Editor", icon: <Map className="h-4 w-4" /> },
      { href: "/search-test", label: "Search Test", icon: <FlaskConical className="h-4 w-4" /> },
      { href: "/intent-stats", label: "Intent Stats", icon: <Search className="h-4 w-4" /> },
      { href: "/webapi-bps-status", label: "Status WebAPI BPS", icon: <Activity className="h-4 w-4" /> },
      { href: "/fetch-logs", label: "Fetch Logs", icon: <FileText className="h-4 w-4" /> },
      { href: "/exim-hs", label: "EXIM HS Lookup", icon: <ShipWheel className="h-4 w-4" /> },
      { href: "/period-availability", label: "Period Check", icon: <CalendarClock className="h-4 w-4" /> },
      { href: "/metabase", label: "Metabase Embed", icon: <BarChart3 className="h-4 w-4" /> },
    ],
  },
  {
    title: "AI & Analytics",
    items: [
      { href: "/chats", label: "Chat Logs", icon: <MessageSquare className="h-4 w-4" /> },
      { href: "/feedback", label: "Feedback", icon: <Star className="h-4 w-4" /> },
      { href: "/knowledge", label: "Knowledge Base", icon: <Brain className="h-4 w-4" /> },
      { href: "/malika-analysis", label: "Error Analysis", icon: <Target className="h-4 w-4" /> },
    ],
  },
  {
    title: "Settings",
    items: [
      { href: "/users", label: "Users", icon: <Users className="h-4 w-4" /> },
    ],
  },
];

function navLinkClass(active: boolean) {
  return [
    "flex items-center gap-3 px-3 py-2 rounded text-sm transition-colors",
    active
      ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
      : "text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
  ].join(" ");
}

export default function Sidebar({ variant = "desktop", collapsed = false, onNavigate }: Props) {
  const pathname = usePathname() || "";

  const isActive = (href: string) => {
    if (href === "/dashboard") return pathname === "/dashboard" || pathname.endsWith("/dashboard");
    return pathname === href || pathname.endsWith(href) || pathname.startsWith(href + "/");
  };

  // Collapsed sidebar shows only icons
  const isCollapsed = variant === "desktop" && collapsed;

  const wrapperClass =
    variant === "mobile"
      ? "h-full bg-sidebar text-sidebar-foreground border-r border-sidebar-border p-4 overflow-y-auto"
      : `${isCollapsed ? "w-16" : "w-56"} shrink-0 bg-sidebar text-sidebar-foreground border-r border-sidebar-border h-full ${isCollapsed ? "p-2" : "p-3"} hidden md:block overflow-y-auto transition-all duration-200`;

  return (
    <aside className={wrapperClass}>
      <div className={`flex items-center ${isCollapsed ? "justify-center" : "justify-between"} mb-5`}>
        <Link href="/dashboard" className={`flex items-center ${isCollapsed ? "justify-center" : "gap-2.5"} min-w-0`} title="MALIKA Admin">
          {/* Monochrome logo - uses currentColor for theme adaptation */}
          <Image
            src="/backend/logo-mono.svg"
            alt="MALIKA"
            width={32}
            height={32}
            className="shrink-0"
          />
          {!isCollapsed && (
            <div className="leading-tight min-w-0">
              <div className="text-sm font-bold tracking-wide truncate">MALIKA</div>
              <div className="text-[10px] text-muted-foreground truncate">Admin Panel</div>
            </div>
          )}
        </Link>
        {variant === "mobile" && (
          <button className="px-2 py-1 rounded hover:bg-sidebar-accent text-muted-foreground" onClick={onNavigate} aria-label="Close">
            ✕
          </button>
        )}
      </div>

      <nav className={`space-y-${isCollapsed ? "2" : "4"}`}>
        {NAV_GROUPS.map((group) => (
          <div key={group.title}>
            {!isCollapsed && (
              <div className="px-3 mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                {group.title}
              </div>
            )}
            <div className="space-y-0.5">
              {group.items.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`${navLinkClass(isActive(item.href))} ${isCollapsed ? "justify-center px-2" : ""}`}
                  onClick={onNavigate}
                  title={isCollapsed ? item.label : undefined}
                >
                  {item.icon}
                  {!isCollapsed && <span>{item.label}</span>}
                </Link>
              ))}
            </div>
          </div>
        ))}
      </nav>

      {!isCollapsed && (
        <div className="mt-6 pt-4 border-t border-sidebar-border">
          <div className="px-3 text-[10px] text-muted-foreground/50">
            v1.0 · BPS Maluku Utara
          </div>
        </div>
      )}
    </aside>
  );
}
