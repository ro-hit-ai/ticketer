// src/layouts/Header.jsx
import React from "react";
import { Link, useLocation } from "react-router-dom";
import { Bell, Search, HelpCircle, UserCircle2 } from "lucide-react";
import AccountDropdown from "../components/AccountDropdown";
import { SidebarTrigger } from "../shadcn/ui/sidebar";

function Header({ user }) {
  const location = useLocation();
  const isPortal = location.pathname.startsWith("/portal");

  return (
    <header className="sticky top-0 z-30 flex items-center gap-x-4 border-b bg-[var(--fd-header-bg)] px-4 h-14 sm:gap-x-6">
      {/* LEFT: Sidebar toggle + Search */}
      <div className="flex items-center gap-3 flex-1 min-w-0">
        <SidebarTrigger className="flex" />

        <div className="relative flex-1 max-w-xl hidden sm:block">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search in tickets, inbox..."
            className="w-full pl-9 pr-3 py-1.5 text-sm rounded-md border bg-background focus:outline-none focus:ring-2 focus:ring-primary/40"
          />
        </div>
      </div>

      {/* RIGHT: Actions */}
      <div className="flex items-center gap-3">
        {isPortal ? (
          <>
            <Link
              to="/notifications"
              className="inline-flex h-9 w-9 items-center justify-center rounded-full border bg-background text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              title="Support"
            >
              <HelpCircle className="h-4 w-4" />
              <span className="sr-only">Support</span>
            </Link>
            <Link
              to="/portal/profile"
              className="inline-flex h-9 w-9 items-center justify-center rounded-full border bg-background text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              title="Profile"
            >
              <UserCircle2 className="h-4 w-4" />
              <span className="sr-only">Profile</span>
            </Link>
          </>
        ) : (
          <button
            type="button"
            className="hidden sm:inline-flex h-8 px-2 items-center gap-1 text-xs rounded-md border bg-background hover:bg-muted"
          >
            <HelpCircle className="h-3.5 w-3.5" />
            Help
          </button>
        )}

        <Link to="/notifications" className="relative">
          <span className="sr-only">View notifications</span>
          <Bell className="h-5 w-5 text-muted-foreground" />
          {user?.notifications?.some((n) => !n.read) && (
            <span className="absolute -top-0.5 -right-0.5 block h-2.5 w-2.5 rounded-full bg-emerald-500 animate-pulse" />
          )}
        </Link>

        <AccountDropdown user={user} />
      </div>
    </header>
  );
}

export default Header;
