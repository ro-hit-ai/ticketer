// src/App.jsx
import React from "react";
import {
  Routes,
  Route,
  Navigate,
  useLocation,
} from "react-router-dom";

import { SidebarProvider } from "./shadcn/ui/sidebar";

import AdminLayout from "./layouts/adminLayout";
import PortalLayout from "./layouts/portalLayout";
import AgentsLayout from "./layouts/agentLayout";

import NotificationsPage from "./pages/notifications";
import OnboardingPage from "./pages/onboarding";
import ProfilePage from "./pages/profile";
import SubmitPage from "./pages/submit";
import NotFoundPage from "./pages/404";
import LoginPage from "./pages/auth/login";

import Inbox from "./pages/inbox";
import Ticket from "./pages/tickets";
import NewTicket from "./pages/tickets/new";
import TicketDetail from "./pages/tickets/detail";
import TicketSearch from "./pages/tickets/search";

import Users from "./pages/admin/users";
import NewUser from "./pages/admin/users/new";
import Clients from "./pages/admin/clients";
import NewClient from "./pages/admin/clients/new";
import EmailQueuesList from "./pages/admin/email-queues";
import NewEmailQueue from "./pages/admin/email-queues/new";
import AdminMailboxes from "./pages/admin/mailboxes";
import AdminMessages from "./pages/admin/messages";
import AdminThreads from "./pages/admin/threads";
import Webhooks from "./pages/admin/webhooks";
import SMTP from "./pages/admin/smtp";
import OAuth from "./pages/admin/smtp/oauth";
import Authentication from "./pages/admin/authentication";
import Roles from "./pages/admin/roles";
import NewRole from "./pages/admin/roles/new";
import Logs from "./pages/admin/logs";
import MailerOpsPage from "./pages/admin/mailer-ops";
import AgentMailboxes from "./pages/agents/mailboxes";
import AgentMessages from "./pages/agents/messages";
import AgentThreads from "./pages/agents/threads";
import PortalMessages from "./pages/portal/messages";
import PortalThreads from "./pages/portal/threads";

import { useUser } from "./store/session";

/* ============================================================
   ERROR BOUNDARY
============================================================ */
class ErrorBoundary extends React.Component {
  state = { hasError: false, error: null };
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="flex h-screen items-center justify-center text-red-500 p-4 bg-red-50">
          <div>
            <p>Something went wrong: {this.state.error?.message || "Unknown"}</p>
            <button
              onClick={() => window.location.reload()}
              className="mt-4 px-4 py-2 bg-green-600 text-white rounded-md"
            >
              Refresh
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

/* ============================================================
   ROLE-BASED ACCESS CONTROL
============================================================ */
function RequireRole({ children, adminOnly, agentOnly, portalOnly }) {
  const { user, loading, isAdmin, isAgent } = useUser();

  if (loading && !user) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="animate-spin h-10 w-10 border-b-2 border-primary rounded-full"></div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/auth/login" replace />;
  }

  if (adminOnly && !isAdmin) {
    return <Navigate to={isAgent ? "/agents/tickets?status=open" : "/portal"} replace />;
  }

  if (agentOnly && !isAgent) {
    return <Navigate to={isAdmin ? "/admin" : "/portal"} replace />;
  }

  if (portalOnly && (isAdmin || isAgent)) {
    return <Navigate to={isAdmin ? "/admin" : "/agents/tickets?status=open"} replace />;
  }

  return children;
}

/* ============================================================
   AUTO-REDIRECT AFTER LOGIN
============================================================ */
function RedirectAfterLogin() {
  const { user, loading } = useUser();
  const location = useLocation();

  if (loading || !user || !location.pathname.startsWith("/auth")) {
    return null;
  }

  if (user.isAdmin) {
    return <Navigate to="/admin" replace />;
  }

  if (user.isAgent) {
    return <Navigate to="/agents/tickets?status=open" replace />;
  }

  return <Navigate to="/portal" replace />;
}

function LandingRoute() {
  const { user, loading } = useUser();

  if (loading && !user) {
    return (
      <div className="flex items-center justify-center h-screen bg-background">
        <div className="animate-spin h-12 w-12 border-b-2 border-primary rounded-full"></div>
        <p className="ml-4">Authenticating...</p>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/auth/login" replace />;
  }

  if (user.isAdmin) {
    return <Navigate to="/admin" replace />;
  }

  if (user.isAgent) {
    return <Navigate to="/agents/tickets?status=open" replace />;
  }

  return <Navigate to="/portal" replace />;
}

/* ============================================================
   MAIN APP
============================================================ */
function App() {
  const { user, loading } = useUser();

  if (loading && !user) {
    return (
      <div className="flex items-center justify-center h-screen bg-background">
        <div className="animate-spin h-12 w-12 border-b-2 border-primary rounded-full"></div>
        <p className="ml-4">Authenticating...</p>
      </div>
    );
  }

  return (
    <SidebarProvider>
      <ErrorBoundary>
        <RedirectAfterLogin />

        <Routes>
          {/* PUBLIC */}
          <Route path="/" element={<LandingRoute />} />
          <Route path="/auth/login" element={<LoginPage />} />
          <Route path="/onboarding" element={<OnboardingPage />} />
          <Route path="/submit" element={<SubmitPage />} />

          {/* ============================================================
             PORTAL (Customers / Normal Users)
          ============================================================== */}
          <Route
            path="/portal"
            element={
              <RequireRole portalOnly>
                <PortalLayout />
              </RequireRole>
            }
          >
            <Route index element={<Navigate to="inbox" replace />} />
            <Route path="inbox" element={<Inbox />} />

            {/* Ticket routes */}
            <Route path="tickets">
              <Route index element={<Ticket />} />
              <Route path="new" element={<NewTicket />} />
              <Route path="search" element={<TicketSearch />} />
              <Route path=":id" element={<TicketDetail />} />
            </Route>

            <Route path="profile" element={<ProfilePage />} />
            <Route path="threads" element={<PortalThreads />} />
            <Route path="messages" element={<PortalMessages />} />
          </Route>

          {/* ============================================================
             AGENTS (Support Agents)
          ============================================================== */}
          <Route
            path="/agents"
            element={
              <RequireRole agentOnly>
                <AgentsLayout />
              </RequireRole>
            }
          >
            <Route index element={<Navigate to="tickets?status=open" replace />} />

            <Route path="tickets">
              <Route index element={<Ticket />} />
              <Route path="new" element={<NewTicket />} />
              <Route path="search" element={<TicketSearch />} />
              <Route path=":id" element={<TicketDetail />} />
            </Route>

            <Route path="profile" element={<ProfilePage />} />
            <Route path="mailboxes" element={<AgentMailboxes />} />
            <Route path="threads" element={<AgentThreads />} />
            <Route path="messages" element={<AgentMessages />} />
          </Route>

          {/* ============================================================
             ADMIN
          ============================================================== */}
          <Route
            path="/admin"
            element={
              <RequireRole adminOnly>
                <AdminLayout />
              </RequireRole>
            }
          >
            <Route index element={<Navigate to="users" replace />} />

            <Route path="users" element={<Users />} />
            <Route path="users/new" element={<NewUser />} />

            <Route path="clients" element={<Clients />} />
            <Route path="clients/new" element={<NewClient />} />

            <Route path="email-queues" element={<EmailQueuesList />} />
            <Route path="email-queues/new" element={<NewEmailQueue />} />
            <Route path="mailboxes" element={<AdminMailboxes />} />
            <Route path="threads" element={<AdminThreads />} />
            <Route path="messages" element={<AdminMessages />} />

            <Route path="webhooks" element={<Webhooks />} />
            <Route path="smtp" element={<SMTP />} />
            <Route path="smtp/oauth" element={<OAuth />} />
            <Route path="authentication" element={<Authentication />} />
            <Route path="roles" element={<Roles />} />
            <Route path="roles/new" element={<NewRole />} />
            <Route path="logs" element={<Logs />} />
            <Route path="mailer-ops" element={<MailerOpsPage />} />
          </Route>

          {/* 404 */}
          <Route
            path="*"
            element={user ? <NotFoundPage /> : <Navigate to="/auth/login" replace />}
          />
        </Routes>
      </ErrorBoundary>
    </SidebarProvider>
  );
}

export default App;
