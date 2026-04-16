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
} from "lucide-react";

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

  const mailboxFolder = useMemo(() => {
    const params = new URLSearchParams(location.search);
    return params.get("folder") || "inbox";
  }, [location.search]);

  // Auto /portal → inbox or tickets
  useEffect(() => {
    if (location.pathname === "/portal") {
      const target = imap_enabled ? "/portal/inbox" : "/portal/tickets";
      navigate(target, { replace: true });
    }
  }, [location.pathname, imap_enabled, navigate]);

  // NAV ITEMS
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
      active:
        location.pathname.startsWith("/portal/threads"),
      children: [
        {
          title: "Application Threads",
          href: "/portal/threads",
          active: location.pathname.startsWith("/portal/threads"),
        },
      ],
    });

    return items;
  }, [imap_enabled, location.pathname, mailboxFolder]);

  useEffect(() => {
    const activeSection = sidebarSections.find((section) => section.active);
    if (activeSection) {
      setExpandedSection(activeSection.key);
    } else if (sidebarSections[0]) {
      setExpandedSection(sidebarSections[0].key);
    }
  }, [sidebarSections]);

  const isLoading = loading && !user;

  return (
    isLoading ? (
      <div className="flex items-center justify-center h-screen bg-background">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary" />
      </div>
    ) : (
    <div className="flex h-screen w-full bg-slate-100">
      {/* LEFT: SIDEBAR */}
      <Sidebar>
        <SidebarHeader>
          {open ? (
            <div className="flex w-full items-center gap-3 px-2 py-1">
              <div
                className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-600 text-xs font-semibold text-white"
              >
                GR
              </div>
              <div className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-semibold text-slate-900">
                  Grassroots Portal
                </span>
                <span className="block truncate text-[11px] text-slate-500">
                  Communication workspace
                </span>
              </div>
            </div>
          ) : (
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-600 text-xs font-semibold text-white">
              GR
            </div>
          )}
        </SidebarHeader>

        <SidebarContent>
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
                          ? "bg-emerald-100 text-emerald-700"
                          : "text-slate-500"
                      )}
                    >
                      <section.icon className="h-4 w-4" />
                    </span>
                    <span className="truncate">{section.title}</span>
                    {open ? (
                      isExpanded ? (
                        <ChevronDown className="ml-auto h-4 w-4 text-slate-400" />
                      ) : (
                        <ChevronRight className="ml-auto h-4 w-4 text-slate-400" />
                      )
                    ) : null}
                  </SidebarMenuButton>

                  {open && isExpanded && section.children?.length ? (
                    <SidebarMenuSub>
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
          <div className="flex flex-col gap-2">
            <ThemeSettings />
            <span className="px-2 text-[10px] text-slate-400">
              {open ? `v${CLIENT_VERSION}` : `v${CLIENT_VERSION}`}
            </span>
          </div>
        </SidebarFooter>
      </Sidebar>

      {/* RIGHT: MAIN AREA */}
      <div className="flex flex-col flex-1 min-w-0">
        <Header user={user} />

        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto flex w-full max-w-[1600px] flex-col p-4 md:p-6">
            <Outlet />
          </div>
        </main>

        <footer className="border-t border-slate-200 bg-white px-4 py-2">
          <div className="mx-auto flex w-full max-w-[1600px] items-center justify-between gap-3">
            <div className="text-xs text-slate-500">
              {imap_enabled ? "Mailbox connected" : "Mailbox unavailable"}
            </div>
            <AccountDropdown user={user} />
          </div>
        </footer>
      </div>
    </div>
    )
  );
}
