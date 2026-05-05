import React from "react";
import { Link, Outlet, useLocation } from "react-router-dom";
import Header from "./Header.jsx";
import ThemeSettings from "../components/ThemeSettings";
import AccountDropdown from "../components/AccountDropdown";
import { Mail, Mailbox, MailOpen, MessageSquare, Plus, Ticket } from "lucide-react";
import { useUser } from "../store/session.jsx";
import { DeskShell } from "../components/layout/DeskPrimitives.jsx";

function classNames(...classes) {
  return classes.filter(Boolean).join(" ");
}

function renderNavigationGroups(groups) {
  return groups.map((group) => (
    <div key={group.title}>
      <div className="px-3 pb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">
        {group.title}
      </div>
      <div className="space-y-1">
        {group.items.map((item) => (
          <Link
            key={item.title}
            to={item.href}
            className={classNames(
              item.active
                ? "border-l-2 border-emerald-500 bg-emerald-50 text-emerald-700"
                : "text-slate-700 hover:bg-slate-100",
              "flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors"
            )}
          >
            <item.icon className="h-4 w-4 shrink-0" />
            <span className="truncate">{item.title}</span>
          </Link>
        ))}
      </div>
    </div>
  ));
}

export default function AgentsLayout() {
  const location = useLocation();
  const { user } = useUser();
  const [denseMode, setDenseMode] = React.useState(true);
  React.useEffect(() => {
    const saved = localStorage.getItem("layoutDensity");
    if (saved === "comfortable") setDenseMode(false);
  }, []);
  React.useEffect(() => {
    localStorage.setItem("layoutDensity", denseMode ? "dense" : "comfortable");
  }, [denseMode]);

  const navigationGroups = [
    {
      title: "Workspace",
      items: [
        {
          title: "Tickets",
          href: "/agents/tickets?status=open",
          active: location.pathname.startsWith("/agents/tickets"),
          icon: Ticket,
        },
      ],
    },
    {
      title: "Communication",
      items: [
        {
          title: "Inbox",
          href: "/agents/messages",
          active: location.pathname.startsWith("/agents/messages"),
          icon: MailOpen,
        },
        {
          title: "Threads",
          href: "/agents/threads",
          active: location.pathname.startsWith("/agents/threads"),
          icon: MessageSquare,
        },
        {
          title: "Messages",
          href: "/agents/messages",
          active: location.pathname.startsWith("/agents/messages"),
          icon: Mail,
        },
        {
          title: "Mailboxes",
          href: "/agents/mailboxes",
          active: location.pathname.startsWith("/agents/mailboxes"),
          icon: Mailbox,
        },
      ],
    },
  ];

  return (
    <DeskShell>
      <div className="desk-skin-root">
        <div className="flex h-screen">
          <div className="hidden md:flex w-64 border-r border-slate-200/80 flex-col bg-white/90 backdrop-blur-xl">
            <div className="h-12 flex items-center gap-2.5 px-3 border-b border-slate-200">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-600 text-xs font-semibold text-white">
                GR
              </div>
              <div className="min-w-0">
                <div className="truncate text-xs font-semibold text-slate-900">Grassroots Agent</div>
                <div className="truncate text-[11px] text-slate-500">Communication workspace</div>
              </div>
            </div>

            <nav className="flex-1 px-3 py-3 space-y-4 overflow-y-auto">
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5">
                <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">Agent Status</div>
                <div className="mt-1 flex items-center justify-between text-[11px] text-slate-600">
                  <span>Session</span>
                  <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 font-semibold text-emerald-700">Active</span>
                </div>
              </div>
              <Link
                to="/agents/tickets?status=open"
                className="inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-[11px] font-semibold text-white transition-colors hover:bg-emerald-700"
              >
                <Plus className="h-3.5 w-3.5" />
                Open Queue
              </Link>
              {renderNavigationGroups(navigationGroups)}
            </nav>

            <div className="mt-auto border-t border-slate-200 p-4">
              <ThemeSettings />
            </div>
          </div>

          <div className="flex min-w-0 flex-1 flex-col">
            <Header user={user} />
            <main className="flex-1 overflow-y-auto">
              <div className={classNames("mx-auto flex w-full max-w-[1600px] flex-col", denseMode ? "gap-3 p-3 md:p-4" : "gap-4 p-4 md:p-6")}>
                <div className={classNames("desk-skin-panel rounded-2xl", denseMode ? "p-2.5 md:p-3" : "p-3 md:p-4")}>
                  <Outlet />
                </div>
              </div>
            </main>

            <footer className="border-t border-slate-200 bg-white px-4 py-2">
              <div className="mx-auto flex w-full max-w-[1600px] items-center justify-between gap-3">
                <div className="text-xs text-slate-500">Agent communication layer</div>
                <AccountDropdown user={user} />
              </div>
            </footer>
          </div>
        </div>
      </div>
    </DeskShell>
  );
}

