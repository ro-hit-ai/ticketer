// AdminLayout.jsx
import React, { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { Dialog, Transition } from "@headlessui/react";
import { XMarkIcon } from "@heroicons/react/24/outline";
import { Link, Outlet, useLocation, useNavigate } from "react-router-dom";
import Header from "./Header.jsx";
import ThemeSettings from "../components/ThemeSettings";
import AccountDropdown from "../components/AccountDropdown";
import {
  ContactIcon,
  Plus,
  MessageSquareText,
  UserPlus,
  FileText,
  KeyRound,
  Mail,
  Mailbox,
  RollerCoaster,
  UserRound,
  Webhook,
  Gauge,
} from "lucide-react";
import { useUser } from "../store/session.jsx";
import { DeskContentCard, DeskPageHero, DeskShell } from "../components/layout/DeskPrimitives.jsx";
import CommandPalette from "../components/admin/CommandPalette.jsx";

function classNames(...classes) {
  return classes.filter(Boolean).join(" ");
}

const ADMIN_ROUTE_META = [
  { match: "/admin/users", title: "User Operations", description: "Manage workspace members, permissions, and access visibility." },
  { match: "/admin/clients", title: "Client Directory", description: "Organize accounts, ownership, and service relationships." },
  { match: "/admin/tickets", title: "Ticket Operations", description: "Track issue volume, status movement, and assignment quality." },
  { match: "/admin/email-queues", title: "Queue Control", description: "Configure send/receive channels and queue health." },
  { match: "/admin/mailboxes", title: "Mailbox Governance", description: "Maintain inbound channels and mailbox ownership." },
  { match: "/admin/threads", title: "Thread Command Center", description: "Review thread lifecycle and route communication flow." },
  { match: "/admin/messages", title: "Message Audit", description: "Inspect message history, delivery behavior, and handoffs." },
  { match: "/admin/smtp", title: "SMTP Configuration", description: "Manage templates, credentials, and outbound reliability." },
  { match: "/admin/webhooks", title: "Webhook Events", description: "Monitor event hooks and integration signal flow." },
  { match: "/admin/authentication", title: "Authentication Policy", description: "Control login methods and security settings." },
  { match: "/admin/roles", title: "Role Controls", description: "Design role capabilities and least-privilege access." },
  { match: "/admin/logs", title: "Operational Logs", description: "Trace system behavior and investigate incidents." },
  { match: "/admin/mailer-ops", title: "Mailer Reliability", description: "Monitor retries, dead letters, audit events, and delivery latency." },
];

function resolveAdminRouteMeta(pathname) {
  const item = ADMIN_ROUTE_META.find((entry) => pathname.startsWith(entry.match));
  return (
    item || {
      title: "Admin Console",
      description: "Central workspace for support operations and platform controls.",
    }
  );
}

function renderNavigationGroups(groups, onNavigate) {
  return groups.map((group) => (
    <li key={group.title}>
      <div className="px-2 pb-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-400">
        {group.title}
      </div>
      <ul role="list" className="-mx-2 space-y-1">
        {group.items.map((item) => (
          <li key={item.name}>
            <Link
              to={item.href}
              className={classNames(
                item.current
                  ? "bg-gradient-to-r from-emerald-500/15 via-cyan-500/10 to-transparent text-slate-900 ring-1 ring-emerald-200 shadow-sm"
                  : "text-slate-600 hover:bg-slate-100/90 hover:text-slate-900",
                "group -mx-2 flex items-center gap-x-3 rounded-lg p-2 text-[13px] font-semibold leading-6 transition-all"
              )}
              onClick={() => onNavigate && onNavigate(item.href)}
            >
              <span
                className={classNames(
                  "ml-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors",
                  item.current ? "bg-white text-emerald-600 shadow-sm" : "bg-slate-200/70 text-slate-500 group-hover:bg-white"
                )}
              >
                <item.icon className="h-4 w-4" />
              </span>
              <span className="whitespace-nowrap">{item.name}</span>
              {item.badge ? (
                <span className="ml-auto rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.08em] text-emerald-700">
                  {item.badge}
                </span>
              ) : null}
            </Link>
          </li>
        ))}
      </ul>
    </li>
  ));
}

function AdminLayout({ onNavigate }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [queueStats, setQueueStats] = useState({ open: 0, unassigned: 0, slaRisk: 0 });
  const gSequenceRef = useRef(false);
  const location = useLocation();
  const navigate = useNavigate();
  const { user, fetchWithAuth } = useUser();
  const clientVersion = import.meta.env.VITE_CLIENT_VERSION || "1.0.0";
  const activeThreadId = new URLSearchParams(location.search).get("threadId");

  const withActiveThreadContext = (basePath) => {
    if (!activeThreadId) return basePath;
    if (basePath === "/admin/threads" || basePath === "/admin/messages") {
      return `${basePath}?threadId=${encodeURIComponent(activeThreadId)}`;
    }
    return basePath;
  };
  const routeMeta = useMemo(() => resolveAdminRouteMeta(location.pathname), [location.pathname]);
  const adminBreadcrumb = routeMeta.title;
  const isCommunicationRoute =
    location.pathname.startsWith("/admin/threads") || location.pathname.startsWith("/admin/messages");

  useEffect(() => {
    const loadCounters = async () => {
      try {
        const response = await fetchWithAuth("/v1/ticket/tickets/all");
        const data = await response.json();
        const tickets = Array.isArray(data?.tickets) ? data.tickets : [];
        const open = tickets.filter((ticket) => !ticket.isComplete).length;
        const unassigned = tickets.filter((ticket) => !ticket.assignedTo?.name).length;
        const slaRisk = tickets.filter((ticket) => {
          const updatedAt = new Date(ticket.updatedAt || ticket.createdAt).getTime();
          return Date.now() - updatedAt > 18 * 60 * 60 * 1000;
        }).length;
        setQueueStats({ open, unassigned, slaRisk });
      } catch {
        setQueueStats({ open: 0, unassigned: 0, slaRisk: 0 });
      }
    };

    if (fetchWithAuth) {
      loadCounters();
      const interval = setInterval(loadCounters, 30000);
      return () => clearInterval(interval);
    }
  }, [fetchWithAuth]);

  useEffect(() => {
    const onKeyDown = (event) => {
      const targetTag = event.target?.tagName?.toLowerCase();
      const isTyping = targetTag === "input" || targetTag === "textarea" || event.target?.isContentEditable;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen((prev) => !prev);
        return;
      }
      if (isTyping) return;
      if (event.key === "/") {
        event.preventDefault();
        setPaletteOpen(true);
        return;
      }
      if (event.key.toLowerCase() === "c") {
        event.preventDefault();
        onNavigate ? onNavigate("/admin/tickets") : navigate("/admin/tickets");
        return;
      }
      if (gSequenceRef.current) {
        if (event.key.toLowerCase() === "t") {
          onNavigate ? onNavigate("/admin/tickets") : navigate("/admin/tickets");
        }
        if (event.key.toLowerCase() === "u") {
          onNavigate ? onNavigate("/admin/users") : navigate("/admin/users");
        }
        gSequenceRef.current = false;
        return;
      }
      if (event.key.toLowerCase() === "g") {
        gSequenceRef.current = true;
        window.setTimeout(() => {
          gSequenceRef.current = false;
        }, 800);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [navigate, onNavigate]);

  const commandItems = [
    { id: "go-tickets", title: "Go to Tickets", description: "Open split-view ticket workspace", icon: "ticket", route: "/admin/tickets", shortcut: "g t", keywords: "tickets queue open" },
    { id: "go-users", title: "Go to Users", description: "Manage users and permissions", icon: "users", route: "/admin/users", shortcut: "g u", keywords: "users members roles" },
    { id: "go-messages", title: "Go to Conversations", description: "Open thread conversations", icon: "messages", route: "/admin/messages", keywords: "threads messages communication" },
    { id: "create-ticket", title: "Create Ticket", description: "Jump to ticket creation flow", icon: "create", route: "/admin/tickets", shortcut: "c", keywords: "new ticket create" },
  ];

  const navigationGroups = [
    {
      title: "Workspace",
      items: [
        {
          name: "Users",
          href: "/admin/users",
          current: location.pathname.startsWith("/admin/users"),
          icon: UserRound,
        },
        {
          name: "Clients",
          href: "/admin/clients",
          current: location.pathname.startsWith("/admin/clients"),
          icon: ContactIcon,
        },
        {
          name: "Tickets",
          href: "/admin/tickets",
          current: location.pathname.startsWith("/admin/tickets"),
          icon: FileText,
          badge: queueStats.open > 0 ? String(queueStats.open) : null,
        },
      ],
    },
    {
      title: "Email",
      items: [
        {
          name: "Email Queues",
          href: "/admin/email-queues",
          current: location.pathname.startsWith("/admin/email-queues"),
          icon: Mail,
        },
        {
          name: "Mailboxes",
          href: "/admin/mailboxes",
          current: location.pathname.startsWith("/admin/mailboxes"),
          icon: Mailbox,
        },
        {
          name: "Threads",
          href: withActiveThreadContext("/admin/threads"),
          current: location.pathname.startsWith("/admin/threads"),
          icon: FileText,
          badge: "Ops",
        },
        {
          name: "Messages",
          href: withActiveThreadContext("/admin/messages"),
          current: location.pathname.startsWith("/admin/messages"),
          icon: Mail,
          badge: queueStats.slaRisk > 0 ? `${queueStats.slaRisk}` : null,
        },
        {
          name: "SMTP Email",
          href: "/admin/smtp",
          current: location.pathname.startsWith("/admin/smtp"),
          icon: Mailbox,
        },
      ],
    },
    {
      title: "System",
      items: [
        {
          name: "Webhooks",
          href: "/admin/webhooks",
          current: location.pathname.startsWith("/admin/webhooks"),
          icon: Webhook,
        },
        {
          name: "Authentication",
          href: "/admin/authentication",
          current: location.pathname.startsWith("/admin/authentication"),
          icon: KeyRound,
        },
        {
          name: "Roles",
          href: "/admin/roles",
          current: location.pathname.startsWith("/admin/roles"),
          icon: RollerCoaster,
        },
        {
          name: "Logs",
          href: "/admin/logs",
          current: location.pathname.startsWith("/admin/logs"),
          icon: FileText,
        },
        {
          name: "Mailer Ops",
          href: "/admin/mailer-ops",
          current: location.pathname.startsWith("/admin/mailer-ops"),
          icon: Gauge,
        },
      ],
    },
  ];

  return (
    <DeskShell>
    <div className="desk-skin-root">
      {/* Top Header */}
      <Header user={user} setSidebarOpen={setSidebarOpen} />

      <div className="flex min-h-[calc(100vh-56px)]">
        {/* Mobile sidebar */}
        <Transition.Root show={sidebarOpen} as={Fragment}>
          <Dialog as="div" className="relative z-50 lg:hidden" onClose={setSidebarOpen}>
            <div className="fixed inset-0 bg-slate-900/80 backdrop-blur-sm" />
            <div className="fixed inset-0 flex">
              <Dialog.Panel className="relative mr-16 flex w-full max-w-xs flex-1">
                <div className="absolute left-full top-0 flex w-16 justify-center pt-5">
                  <button
                    type="button"
                    className="-m-2.5 p-2.5"
                    onClick={() => setSidebarOpen(false)}
                  >
                    <span className="sr-only">Close sidebar</span>
                    <XMarkIcon className="h-6 w-6 text-white" aria-hidden="true" />
                  </button>
                </div>

                {/* Sidebar content */}
                <div className="flex grow flex-col gap-y-5 overflow-y-auto border-r border-slate-200/80 bg-white px-6 pb-4 shadow-2xl">
                  <div className="flex h-16 items-center border-b border-slate-200">
                    <Link to="/admin">
                      <div className="ml-1.5">
                        <div className="text-xl font-bold tracking-tight text-slate-900">Grassroots</div>
                        <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                          Admin Console
                        </div>
                      </div>
                    </Link>
                  </div>
                  <div className="rounded-xl border border-emerald-100 bg-gradient-to-br from-emerald-50 to-cyan-50 p-3">
                    {/* <div className="text-xs font-semibold uppercase tracking-[0.14em] text-emerald-700">
                      Premium Desk
                    </div> */}
                    {/* <div className="mt-1 text-xs text-slate-600">
                      Centralized operations for threads, messages, and customer records.
                    </div> */}
                  </div>
                  <nav className="flex flex-1 flex-col">
                    <ul role="list" className="flex flex-1 flex-col gap-y-7">
                      {renderNavigationGroups(navigationGroups, onNavigate)}
                    </ul>
                    <ThemeSettings />
                  </nav>
                </div>
              </Dialog.Panel>
            </div>
          </Dialog>
        </Transition.Root>

        {/* Desktop sidebar */}
        <div className="hidden border-r border-slate-200/80 lg:fixed lg:inset-y-0 lg:z-10 lg:flex lg:w-72 lg:flex-col">
          <div className="flex grow flex-col gap-y-5 overflow-y-auto bg-white/90 pb-4 backdrop-blur-xl">
            <div className="flex h-16 items-center border-b border-slate-200 px-6">
              <Link to="/admin">
                <div className="ml-1">
                  <div className="text-2xl font-black tracking-tight text-slate-900">Grassroots</div>
                  <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                    Admin Console
                  </div>
                </div>
              </Link>
            </div>
            {/* <div className="mx-6 rounded-xl border border-emerald-100 bg-gradient-to-br from-emerald-50 to-cyan-50 p-3">
              <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-emerald-700">
                Premium Desk
              </div>
              <div className="mt-1 text-xs text-slate-600">
                Built for admin triage, message oversight, and workflow confidence.
              </div>
            </div> */}
            <nav className="flex flex-1 flex-col px-6 pt-1">
              <div className="mb-3 grid grid-cols-2 gap-2">
                <Link
                  to="/admin/tickets"
                  className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white transition-all hover:-translate-y-[1px] hover:bg-emerald-700"
                >
                  <Plus className="h-3.5 w-3.5" />
                  New Ticket
                </Link>
                <Link
                  to="/admin/users/new"
                  className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition-all hover:-translate-y-[1px] hover:bg-slate-50"
                >
                  <UserPlus className="h-3.5 w-3.5" />
                  New User
                </Link>
              </div>
              <div className="mb-3 grid grid-cols-3 gap-2">
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-2">
                  <div className="text-[10px] uppercase tracking-[0.1em] text-slate-500">Open</div>
                  <div className="mt-1 text-sm font-bold text-slate-800">{queueStats.open}</div>
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-2">
                  <div className="text-[10px] uppercase tracking-[0.1em] text-slate-500">Unassigned</div>
                  <div className="mt-1 text-sm font-bold text-slate-800">{queueStats.unassigned}</div>
                </div>
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-2">
                  <div className="text-[10px] uppercase tracking-[0.1em] text-amber-700">SLA Risk</div>
                  <div className="mt-1 text-sm font-bold text-amber-800">{queueStats.slaRisk}</div>
                </div>
              </div>
              <ul role="list" className="flex flex-1 flex-col gap-y-7 w-full">
                {renderNavigationGroups(navigationGroups, onNavigate)}
              </ul>
              <div className="space-y-2 border-t border-slate-200 pt-3">
                <ThemeSettings />
                <div className="px-2 text-[11px] text-slate-500">
                  Signed in as <span className="font-semibold text-slate-700">{user?.email || "admin"}</span>
                </div>
              </div>
            </nav>
          </div>
        </div>

        {/* Main content */}
        <div className="flex flex-1 flex-col lg:pl-72">
          <main className="w-full flex-1 overflow-y-auto p-4 lg:p-6">
            <div className="mx-auto w-full max-w-[1800px] space-y-4">
              <DeskPageHero
                area="Admin"
                title={adminBreadcrumb}
                description={routeMeta.description}
                statusLabel={`Signed in as ${user?.email || "admin"}`}
                stats={[
                  { label: "Open Tickets", value: String(queueStats.open), tone: "text-emerald-700" },
                  { label: "Unassigned", value: String(queueStats.unassigned), tone: "text-cyan-700" },
                  { label: "SLA Risk", value: String(queueStats.slaRisk), tone: "text-amber-700" },
                ]}
              />
              <div className="desk-skin-panel-strong rounded-xl px-3 py-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Link
                    to="/admin/tickets"
                    className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    <FileText className="h-3.5 w-3.5" />
                    Tickets
                  </Link>
                  <Link
                    to={withActiveThreadContext("/admin/threads")}
                    className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    <MessageSquareText className="h-3.5 w-3.5" />
                    Threads
                  </Link>
                  <Link
                    to={withActiveThreadContext("/admin/messages")}
                    className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    <Mail className="h-3.5 w-3.5" />
                    Messages
                  </Link>
                  <span className="ml-auto rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] text-slate-500">
                    Shortcuts: `/`, `g+t`, `g+u`, `c`, `Cmd/Ctrl+K`
                  </span>
                </div>
              </div>
              {isCommunicationRoute ? (
                <div className="space-y-3">
                  <div className="desk-skin-panel-strong rounded-xl p-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        to={withActiveThreadContext("/admin/threads")}
                        className={classNames(
                          "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors",
                          location.pathname.startsWith("/admin/threads")
                            ? "bg-emerald-100 text-emerald-800"
                            : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                        )}
                      >
                        <MessageSquareText className="h-3.5 w-3.5" />
                        Threads
                      </Link>
                      <Link
                        to={withActiveThreadContext("/admin/messages")}
                        className={classNames(
                          "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors",
                          location.pathname.startsWith("/admin/messages")
                            ? "bg-cyan-100 text-cyan-800"
                            : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                        )}
                      >
                        <Mail className="h-3.5 w-3.5" />
                        Conversations
                      </Link>
                      {activeThreadId ? (
                        <div className="ml-auto rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-medium text-slate-600">
                          Active Thread: {activeThreadId}
                        </div>
                      ) : null}
                    </div>
                  </div>
                  <div className="desk-skin-panel rounded-2xl p-2 lg:p-3">
                    <Outlet />
                  </div>
                </div>
              ) : (
                <DeskContentCard>
                  <Outlet />
                </DeskContentCard>
              )}
            </div>
          </main>

          {/* Footer */}
          <footer className="border-t border-slate-200/80 bg-white/80 px-4 py-3 backdrop-blur-sm lg:px-6">
            <div className="mx-auto flex w-full max-w-[1800px] items-center justify-between gap-3">
              <div className="text-xs font-medium text-slate-500">
                Enterprise workspace active
              </div>
              <div className="flex items-center gap-x-2">
                {user?.isAdmin && (
              <Link to="https://github.com/Peppermint-Lab/peppermint/releases">
                <span className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700">
                  Version {clientVersion}
                </span>
              </Link>
                )}
                <AccountDropdown />
              </div>
            </div>
          </footer>
        </div>
      </div>
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        commands={commandItems}
        onSelect={(command) => {
          if (onNavigate) onNavigate(command.route);
          else navigate(command.route);
        }}
      />
      </div>
    </DeskShell>
  );
}

export default AdminLayout;
