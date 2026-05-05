// src/layouts/portalLayout.jsx
import React, { useEffect, useMemo, useState } from "react";
import { Outlet, useNavigate, useLocation } from "react-router-dom";

import Header from "./Header.jsx";
import ThemeSettings from "../components/ThemeSettings";
import AccountDropdown from "../components/AccountDropdown";
import { useUser } from "../store/session.jsx";

import {
  Sidebar,
  SidebarHeader,
  SidebarContent,
  SidebarFooter,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarMenuSub,
  SidebarMenuSubButton,
  useSidebar,
} from "../shadcn/ui/sidebar.jsx";

import {
  Mail,
  Mailbox,
  MailOpen,
  Send,
  Archive,
  Trash2,
  Ticket,
  ChevronDown,
  ChevronRight,
  MessageSquare,
  Plus,
} from "lucide-react";
import { DeskShell } from "../components/layout/DeskPrimitives.jsx";

const CLIENT_VERSION = import.meta.env.VITE_CLIENT_VERSION || "1.0.0";
const MAILBOX_FOLDERS = [
  { title: "Inbox", folder: "inbox", icon: Mail },
  { title: "Sent", folder: "sent", icon: Send },
  { title: "Processed", folder: "processed", icon: Archive },
  { title: "Drafts", folder: "drafts", icon: Mailbox },
  { title: "Trash", folder: "trash", icon: Trash2 },
];

function classNames(...classes) {
  return classes.filter(Boolean).join(" ");
}

export default function PortalLayout() {
  const { user, loading, imap_enabled } = useUser();
  const navigate = useNavigate();
  const location = useLocation();
  const { open } = useSidebar();
  const [expandedSection, setExpandedSection] = useState(null);
  const [denseMode, setDenseMode] = useState(true);

  useEffect(() => {
    const saved = localStorage.getItem("layoutDensity");
    if (saved === "comfortable") setDenseMode(false);
  }, []);
  useEffect(() => {
    localStorage.setItem("layoutDensity", denseMode ? "dense" : "comfortable");
  }, [denseMode]);

  const mailboxFolder = useMemo(() => {
    const params = new URLSearchParams(location.search);
    return params.get("folder") || "inbox";
  }, [location.search]);

  useEffect(() => {
    if (location.pathname === "/portal") {
      const target = imap_enabled ? "/portal/inbox" : "/portal/tickets";
      navigate(target, { replace: true });
    }
  }, [location.pathname, imap_enabled, navigate]);

  const sidebarSections = useMemo(() => {
    const items = [];

    items.push({
      key: "mailbox",
      title: "Email",
      icon: Mailbox,
      active:
        location.pathname.startsWith("/portal/inbox") ||
        location.pathname.startsWith("/portal/messages"),
      children: [
        ...MAILBOX_FOLDERS.map((mailFolder) => ({
          title: mailFolder.title,
          href: `/portal/inbox?folder=${mailFolder.folder}`,
          active:
            location.pathname === "/portal/inbox" && mailboxFolder === mailFolder.folder,
        })),
        {
          title: "Messages",
          href: "/portal/messages",
          active: location.pathname.startsWith("/portal/messages"),
          icon: MailOpen,
        },
      ],
    });

    items.push({
      key: "tickets",
      title: "Tickets",
      icon: Ticket,
      active: location.pathname.startsWith("/portal/tickets"),
      children: [
        { title: "All Tickets", href: "/portal/tickets", active: location.pathname === "/portal/tickets" },
        { title: "New Ticket", href: "/portal/tickets/new", active: location.pathname === "/portal/tickets/new" },
      ],
    });

    items.push({
      key: "conversations",
      title: "Applications",
      icon: MessageSquare,
      active: location.pathname.startsWith("/portal/threads"),
      children: [
        {
          title: "Application Threads",
          href: "/portal/threads",
          active: location.pathname.startsWith("/portal/threads"),
        },
      ],
    });

    return items;
  }, [location.pathname, mailboxFolder]);

  useEffect(() => {
    const activeSection = sidebarSections.find((section) => section.active);
    if (activeSection) {
      setExpandedSection(activeSection.key);
    } else if (sidebarSections[0]) {
      setExpandedSection(sidebarSections[0].key);
    }
  }, [sidebarSections]);

  const isLoading = loading && !user;

  return isLoading ? (
    <div className="flex items-center justify-center h-screen bg-background">
      <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary" />
    </div>
  ) : (
    <DeskShell>
      <div className="desk-skin-root">
        <div className="flex h-screen w-full">
          <Sidebar>
            <SidebarHeader>
              {open ? (
                <div className="w-full px-2 py-1">
                  <div className="flex items-center gap-2 rounded-lg border border-emerald-100 bg-gradient-to-br from-emerald-50 to-cyan-50 p-2">
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-600 to-cyan-600 text-xs font-semibold text-white shadow-sm">
                      GR
                    </div>
                    <div className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-bold tracking-tight text-slate-900">
                        Grassroots Portal
                      </span>
                      <span className="block truncate text-[10px] font-medium uppercase tracking-[0.12em] text-emerald-700">
                        Client Workspace
                      </span>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-600 to-cyan-600 text-xs font-semibold text-white shadow-sm">
                  GR
                </div>
              )}
            </SidebarHeader>

            <SidebarContent>
              {open ? (
                <div className="mb-2 px-2">
                  <div className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5">
                    <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">Operations</div>
                    <div className="mt-1 flex items-center justify-between text-[11px] text-slate-600">
                      <span>Mode</span>
                      <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 font-semibold text-emerald-700">Live</span>
                    </div>
                  </div>
                </div>
              ) : null}
              <div className="mb-2 px-2">
                <button
                  type="button"
                  onClick={() => navigate("/portal/tickets/new")}
                  className="inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-[11px] font-semibold text-white transition-colors hover:bg-emerald-700"
                >
                  <Plus className="h-3.5 w-3.5" />
                  New Ticket
                </button>
              </div>
              <SidebarMenu>
                {sidebarSections.map((section) => {
                  const isExpanded = expandedSection === section.key;
                  return (
                    <SidebarMenuItem key={section.key}>
                      <SidebarMenuButton
                        active={section.active}
                        onClick={() =>
                          setExpandedSection((current) =>
                            current === section.key ? null : section.key
                          )
                        }
                        tooltip={section.title}
                      >
                        <span
                          className={classNames(
                            "flex h-8 w-8 shrink-0 items-center justify-center rounded-md transition-colors",
                            section.active
                              ? "bg-gradient-to-br from-emerald-500/20 to-cyan-500/20 text-emerald-700 ring-1 ring-emerald-200"
                              : "bg-slate-100 text-slate-500"
                          )}
                        >
                          <section.icon className="h-4 w-4" />
                        </span>
                        <span className="truncate">{section.title}</span>
                        {section.active && open ? (
                          <span className="ml-1 rounded-full border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">
                            Live
                          </span>
                        ) : null}
                        {open ? (
                          isExpanded ? (
                            <ChevronDown className="ml-auto h-4 w-4 text-slate-400" />
                          ) : (
                            <ChevronRight className="ml-auto h-4 w-4 text-slate-400" />
                          )
                        ) : null}
                      </SidebarMenuButton>

                      {open && isExpanded && section.children?.length ? (
                        <SidebarMenuSub className="space-y-1">
                          {section.children.map((sub) => (
                            <SidebarMenuSubButton
                              key={sub.href}
                              active={sub.active || `${location.pathname}${location.search}` === sub.href}
                              onClick={() => navigate(sub.href)}
                              tooltip={sub.title}
                            >
                              <span className="truncate">{sub.title}</span>
                            </SidebarMenuSubButton>
                          ))}
                        </SidebarMenuSub>
                      ) : null}
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarContent>

            <SidebarFooter>
              <div className="flex flex-col gap-2 border-t border-slate-200 pt-2">
                <ThemeSettings />
                {open ? (
                  <div className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5">
                    <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">
                      System
                    </div>
                    <div className="mt-0.5 text-[11px] text-slate-600">
                      Version v{CLIENT_VERSION}
                    </div>
                  </div>
                ) : (
                  <span className="px-2 text-[10px] text-slate-400">v{CLIENT_VERSION}</span>
                )}
              </div>
            </SidebarFooter>
          </Sidebar>

          <div className="flex flex-col flex-1 min-w-0">
            <Header user={user} />
            <main className="flex-1 overflow-y-auto">
              <div className={classNames("mx-auto flex w-full max-w-[1700px] flex-col", denseMode ? "gap-3 p-3 md:p-4" : "gap-4 p-4 md:p-6")}>
                <div className={classNames("desk-skin-panel rounded-2xl", denseMode ? "p-2.5 md:p-3" : "p-3 md:p-4")}>
                  <Outlet />
                </div>
              </div>
            </main>

            <footer className="border-t border-slate-200/80 bg-white/85 px-4 py-2.5 backdrop-blur-sm">
              <div className="mx-auto flex w-full max-w-[1600px] items-center justify-between gap-3">
                <div className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-600">
                  Workspace ready
                </div>
                <AccountDropdown user={user} />
              </div>
            </footer>
          </div>
        </div>
      </div>
    </DeskShell>
  );
}

