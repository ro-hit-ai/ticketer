// src/layouts/agentLayout.jsx
import React from "react";
import { Link, Outlet, useLocation } from "react-router-dom";
import Header from "./Header.jsx";
import ThemeSettings from "../components/ThemeSettings";
import AccountDropdown from "../components/AccountDropdown";
import { Mail, Mailbox, MessageSquare, Ticket } from "lucide-react";
import { useUser } from "../store/session.jsx";

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
                ? "bg-emerald-50 text-emerald-700"
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
    <div className="flex h-screen bg-slate-100">
      {/* SIDEBAR */}
      <div className="hidden md:flex w-64 border-r border-slate-200 flex-col bg-white">
        <div className="h-14 flex items-center gap-3 px-4 border-b border-slate-200">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-600 text-xs font-semibold text-white">
            GR
          </div>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-slate-900">Grassroots Agent</div>
            <div className="truncate text-xs text-slate-500">Communication workspace</div>
          </div>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-6 overflow-y-auto">
          {renderNavigationGroups(navigationGroups)}
        </nav>

        <div className="mt-auto border-t border-slate-200 p-4">
          <ThemeSettings />
        </div>
      </div>

      {/* MAIN */}
      <div className="flex min-w-0 flex-1 flex-col">
        <Header user={user} />
        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto flex w-full max-w-[1600px] flex-col p-4 md:p-6">
            <Outlet />
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
  );
}
