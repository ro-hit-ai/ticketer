// src/pages/portal/Inbox.jsx
import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useNavigate, useSearchParams, Navigate } from "react-router-dom";
import {
  ArrowUpRight,
  CheckCircle2,
  Mail,
  Reply,
  RefreshCw,
  Search,
  ChevronLeft,
  ChevronRight,
  Clock,
  AlertCircle,
  Filter,
  Paperclip,
  Download,
  CheckCheck,
  Flag,
  Send,
  MoreHorizontal,
  MessageSquare,
} from "lucide-react";
import { toast } from "react-toastify";
import { useUser } from "../store/session.jsx";
import { getThreadBySourceCaseId } from "../services/communication.service";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../shadcn/ui/dialog.jsx";
import { Textarea } from "../shadcn/ui/textarea.jsx";

const FOLDER_LABELS = {
  inbox: "Inbox",
  sent: "Sent",
  processed: "Processed",
  trash: "Trash",
  drafts: "Drafts",
  resolved: "Resolved",
  received: "Received",
  internal: "Internal",
};

const HEADER_FILTERS = [
  { title: "Inbox", folder: "inbox" },
  { title: "Sent", folder: "sent" },
  { title: "Processed", folder: "processed" },
];

const CRM_STATUSES = ["Open", "Pending", "Closed"];
const CRM_PRIORITIES = ["Low", "Medium", "High"];
const AGENT_OPTIONS = ["Unassigned", "Ava Patel", "Marcus Reed", "Noah Chen", "Sofia Kim"];

function classNames(...classes) {
  return classes.filter(Boolean).join(" ");
}

function extractEmailAddress(value) {
  const raw = String(value || "").trim();
  const match = raw.match(/<([^>]+)>/);
  if (match?.[1]) return match[1].trim();
  return raw;
}

function extractTicketIdFromSubject(subject) {
  const value = String(subject || "");
  const match = value.match(/(?:ref:|#)([0-9a-fA-F-]{24,36})/i);
  return match?.[1] || null;
}

function extractSourceCaseIdFromEmail(email) {
  const direct =
    email?.sourceCaseId ||
    email?.metadata?.sourceCaseId ||
    email?.metadata?.applicationId ||
    null;
  if (typeof direct === "string" && direct.trim()) {
    return direct.trim().toUpperCase();
  }

  const subject = String(email?.subject || "");
  const appMatch = subject.match(/\b(APP-[A-Z0-9-]{6,})\b/i);
  if (appMatch?.[1]) {
    return appMatch[1].toUpperCase();
  }

  return null;
}

function hasResolvableThreadLink(email) {
  const explicitThreadId =
    typeof email?.threadId === "string"
      ? email.threadId
      : (email?.threadId?._id || null);
  return Boolean(explicitThreadId || extractSourceCaseIdFromEmail(email));
}

function decodeHtmlEntities(value) {
  if (typeof window === "undefined") return value;
  const textArea = document.createElement("textarea");
  textArea.innerHTML = value;
  return textArea.value;
}

function cleanEmailBody(rawBody) {
  const html = String(rawBody || "");
  if (!html.trim()) return "No content";

  const normalized = html
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<\/tr>/gi, "\n")
    .replace(/<li[^>]*>/gi, "")
    .replace(/<[^>]+>/g, " ");

  const decoded = decodeHtmlEntities(normalized)
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n");

  const lines = decoded
    .split("\n")
    .map((line) =>
      line
        .replace(/^\s*[•·▪◦●○\-*]+\s*/g, "")
        .replace(/\s+/g, " ")
        .trim()
    )
    .filter((line, index, arr) => !(line === "" && arr[index - 1] === ""));

  return lines.join("\n").trim() || "No content";
}

function renderInboxBody(rawBody, showQuoted, onToggleQuoted) {
  const text = cleanEmailBody(rawBody);
  const lines = text.split("\n");
  const blocks = [];
  let regular = [];
  let quoted = [];

  const flushRegular = () => {
    if (regular.length) {
      blocks.push({ type: "regular", value: regular.join("\n").trim() });
      regular = [];
    }
  };
  const flushQuoted = () => {
    if (quoted.length) {
      blocks.push({
        type: "quoted",
        value: quoted
          .map((line) => line.replace(/^\s*>+\s?/, ""))
          .join("\n")
          .trim(),
      });
      quoted = [];
    }
  };

  lines.forEach((line) => {
    if (/^\s*>/.test(line)) {
      flushRegular();
      quoted.push(line);
    } else {
      flushQuoted();
      regular.push(line);
    }
  });
  flushRegular();
  flushQuoted();

  return blocks.map((block, index) => {
    if (!block.value) return null;
    if (block.type === "quoted") {
      if (!showQuoted) {
        return (
          <div key={`quoted-collapsed-${index}`} className="mt-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
            <button
              type="button"
              onClick={onToggleQuoted}
              className="font-semibold text-slate-700 hover:text-slate-900"
            >
              Show previous message
            </button>
          </div>
        );
      }
      return (
        <div key={`quoted-${index}`} className="mt-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
          <div className="mb-1 flex items-center justify-between gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-500">Previous message</span>
            <button
              type="button"
              onClick={onToggleQuoted}
              className="text-[11px] font-semibold text-slate-600 hover:text-slate-900"
            >
              Hide
            </button>
          </div>
          <div className="whitespace-pre-wrap">{block.value}</div>
        </div>
      );
    }
    return (
      <p key={`regular-${index}`} className="whitespace-pre-wrap leading-6 text-slate-800">
        {block.value}
      </p>
    );
  });
}

const Inbox = () => {
  const { fetchWithAuth, imap_enabled, loading: sessionLoading } =
    useUser();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [emails, setEmails] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  const [selectedEmail, setSelectedEmail] = useState(null);

  const [folder, setFolder] = useState(searchParams.get("folder") || "inbox");
  const [searchTerm, setSearchTerm] = useState(searchParams.get("q") || "");
  const [page, setPage] = useState(
    parseInt(searchParams.get("page"), 10) || 1
  );
  const [limit] = useState(20);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [selectedEmails, setSelectedEmails] = useState([]);
  const [composeOpen, setComposeOpen] = useState(false);
  const [composeMode, setComposeMode] = useState("new");
  const [composeSending, setComposeSending] = useState(false);
  const [composeForm, setComposeForm] = useState({
    to: "",
    subject: "",
    body: "",
  });
  const [assignedAgent, setAssignedAgent] = useState("Unassigned");
  const [ticketStatus, setTicketStatus] = useState("Open");
  const [priorityValue, setPriorityValue] = useState("Medium");
  const [internalNotes, setInternalNotes] = useState("");
  const [moreActionsOpen, setMoreActionsOpen] = useState(false);
  const [showQuotedContent, setShowQuotedContent] = useState(false);

  const searchTimeoutRef = useRef(null);

  /* ------------------------------------------------------------------
   * FETCH EMAILS (unchanged API logic)
   * ------------------------------------------------------------------ */
  const fetchEmails = useCallback(
    async (
      currFolder = folder,
      currPage = page,
      currSearch = searchTerm,
      currUnread = unreadOnly
    ) => {
      try {
        setLoading(true);

        const params = new URLSearchParams({
          page: currPage.toString(),
          limit: limit.toString(),
        });

        if (currFolder) params.append("folder", currFolder);
        if (currSearch) params.append("q", currSearch);
        if (currUnread) params.append("unreadOnly", "true");

        const url = `/v1/imap/emails?${params}`;
        console.log("🔍 Fetching emails from:", url);

        const res = await fetchWithAuth(url);
        console.log("📡 Response status:", res.status);

        const result = await res.json();
        console.log("📨 Response data:", result);

        if (res.ok && result.success) {
          setEmails(result.emails || []);
          setTotal(result.total || 0);
        } else {
          toast.error(result.message || "Failed to fetch emails", {
            toastId: "fetch-emails-error",
          });
          setEmails([]);
          setTotal(0);
        }
      } catch (err) {
        console.error("❌ IMAP fetch failed:", err);
        toast.error("Inbox temporarily unavailable", {
          toastId: "fetch-emails-error",
        });
        setEmails([]);
        setTotal(0);
      } finally {
        setLoading(false);
      }
    },
    [fetchWithAuth, folder, page, searchTerm, unreadOnly, limit]
  );

  /* ------------------------------------------------------------------
   * DEBOUNCED SEARCH
   * ------------------------------------------------------------------ */
  const debouncedSearch = useCallback((term) => {
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    searchTimeoutRef.current = setTimeout(() => {
      setSearchTerm(term);
      setPage(1);
    }, 300);
  }, []);

  /* ------------------------------------------------------------------
   * REFRESH IMAP (unchanged API logic)
   * ------------------------------------------------------------------ */
  const handleRefresh = useCallback(async () => {
    try {
      const res = await fetchWithAuth("/v1/imap/fetch-emails", {
        method: "POST",
      });
      const result = await res.json();

      if (res.ok && result.success) {
        toast.info("Fetching new emails...", { toastId: "fetch-started" });
        setTimeout(() => fetchEmails(), 2000);
      } else {
        toast.error(result.message || "Failed to start fetch");
      }
    } catch (err) {
      toast.error("Refresh failed");
    }
  }, [fetchWithAuth, fetchEmails]);

  /* ------------------------------------------------------------------
   * PLACEHOLDER ACTIONS (no API yet)
   * ------------------------------------------------------------------ */
  const updateEmailInState = useCallback((updatedEmail) => {
    setEmails((prev) =>
      prev.map((email) => (email._id === updatedEmail._id ? updatedEmail : email))
    );
    setSelectedEmail((prev) => (prev?._id === updatedEmail._id ? updatedEmail : prev));
  }, []);

  const handleMove = useCallback(async (emailId, newFolder) => {
    try {
      const res = await fetchWithAuth(`/v1/imap/emails/${emailId}/move`, {
        method: "POST",
        body: JSON.stringify({ folder: newFolder }),
      });
      const result = await res.json();

      if (!res.ok || !result.success) {
        throw new Error(result.message || "Move failed");
      }

      toast.success(`Email moved to ${FOLDER_LABELS[newFolder] || newFolder}`);
      setSelectedEmails((prev) => prev.filter((id) => id !== emailId));
      fetchEmails();
    } catch (error) {
      toast.error(error.message || "Failed to move email");
    }
  }, [fetchEmails, fetchWithAuth]);

  const handleMarkRead = useCallback(async (emailId, nextReadState) => {
    try {
      const res = await fetchWithAuth(`/v1/imap/emails/${emailId}/read`, {
        method: "PATCH",
        body: JSON.stringify({ isRead: nextReadState }),
      });
      const result = await res.json();

      if (!res.ok || !result.success) {
        throw new Error(result.message || "Update failed");
      }

      updateEmailInState(result.email);
    } catch (error) {
      toast.error(error.message || "Failed to update read state");
    }
  }, [fetchWithAuth, updateEmailInState]);

  const handleBulkMove = useCallback(
    async (newFolder) => {
      if (!selectedEmails.length) return;
      try {
        const res = await fetchWithAuth("/v1/imap/emails/move", {
          method: "POST",
          body: JSON.stringify({ emailIds: selectedEmails, folder: newFolder }),
        });
        const result = await res.json();
        if (!res.ok || !result.success) {
          throw new Error(result.message || "Bulk move failed");
        }

        toast.success(`Moved ${selectedEmails.length} emails`);
        setSelectedEmails([]);
        fetchEmails();
      } catch (error) {
        toast.error(error.message || "Failed to move selected emails");
      }
    },
    [fetchEmails, fetchWithAuth, selectedEmails]
  );

  const handleBulkRead = useCallback(async (nextReadState) => {
    if (!selectedEmails.length) return;

    try {
      const res = await fetchWithAuth("/v1/imap/emails/read", {
        method: "PATCH",
        body: JSON.stringify({ emailIds: selectedEmails, isRead: nextReadState }),
      });
      const result = await res.json();
      if (!res.ok || !result.success) {
        throw new Error(result.message || "Bulk update failed");
      }

      setEmails((prev) =>
        prev.map((email) =>
          selectedEmails.includes(email._id) ? { ...email, isRead: nextReadState } : email
        )
      );
      setSelectedEmail((prev) =>
        prev && selectedEmails.includes(prev._id) ? { ...prev, isRead: nextReadState } : prev
      );
      toast.success(
        nextReadState
          ? `Marked ${selectedEmails.length} emails as read`
          : `Marked ${selectedEmails.length} emails as unread`
      );
      setSelectedEmails([]);
    } catch (error) {
      toast.error(error.message || "Failed to update selected emails");
    }
  }, [fetchWithAuth, selectedEmails]);

  const handleReply = useCallback(async (emailId) => {
    const email = emails.find((item) => item._id === emailId) || selectedEmail;
    if (!email) return;

    const recipient = extractEmailAddress(email.from);
    const normalizedSubject = String(email.subject || "").trim();

    setComposeMode("reply");
    setComposeForm({
      to: recipient,
      subject: normalizedSubject.toLowerCase().startsWith("re:")
        ? normalizedSubject
        : `Re: ${normalizedSubject || "(no subject)"}`,
      body: `\n\nOn ${email.date ? new Date(email.date).toLocaleString() : "an earlier message"}, ${email.from || recipient} wrote:\n${String(email.body || "").replace(/<[^>]+>/g, "")}`,
    });
    setComposeOpen(true);
  }, [emails, selectedEmail]);

  const openCompose = useCallback(() => {
    setComposeMode("new");
    setComposeForm({
      to: "",
      subject: "",
      body: "",
    });
    setComposeOpen(true);
  }, []);

  const handleComposeChange = useCallback((field, value) => {
    setComposeForm((prev) => ({
      ...prev,
      [field]: value,
    }));
  }, []);

  const handleComposeSend = useCallback(async () => {
    if (!composeForm.to.trim() || !composeForm.subject.trim() || !composeForm.body.trim()) {
      toast.error("To, subject, and message are required");
      return;
    }

    try {
      setComposeSending(true);
      const response = await fetchWithAuth("/v1/smtp/send-email", {
        method: "POST",
        body: JSON.stringify({
          to: composeForm.to.trim(),
          subject: composeForm.subject.trim(),
          text: composeForm.body,
          html: composeForm.body
            .split("\n")
            .map((line) => `<p>${line || "&nbsp;"}</p>`)
            .join(""),
        }),
      });
      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.message || "Failed to send email");
      }

      toast.success(composeMode === "reply" ? "Reply sent" : "Email sent");
      setComposeOpen(false);
      setComposeForm({ to: "", subject: "", body: "" });

      if (folder === "sent") {
        fetchEmails("sent", 1, searchTerm, unreadOnly);
      }
    } catch (error) {
      toast.error(error.message || "Failed to send email");
    } finally {
      setComposeSending(false);
    }
  }, [composeForm, composeMode, fetchEmails, fetchWithAuth, folder, searchTerm, unreadOnly]);

  /* ------------------------------------------------------------------
   * EFFECTS
   * ------------------------------------------------------------------ */
  useEffect(() => {
    fetchEmails();
  }, [fetchEmails, imap_enabled]);

  useEffect(() => {
    const nextFolder = searchParams.get("folder") || "inbox";
    if (nextFolder !== folder) {
      setFolder(nextFolder);
      setPage(1);
    }
  }, [searchParams, folder]);

  useEffect(() => {
    setSearchParams(
      {
        folder,
        page: page.toString(),
        ...(searchTerm && { q: searchTerm }),
      },
      { replace: true }
    );
  }, [folder, page, searchTerm, setSearchParams]);

  // When emails change, ensure something is selected (Gmail-style)
  useEffect(() => {
    if (emails.length > 0) {
      // If currently selected email not in new list, select first
      const stillExists = selectedEmail
        ? emails.find((e) => e._id === selectedEmail._id)
        : null;
      if (!stillExists) {
        setSelectedEmail(emails[0]);
      }
    } else {
      setSelectedEmail(null);
    }
  }, [emails, selectedEmail]);

  useEffect(() => {
    if (!selectedEmail) {
      setAssignedAgent("Unassigned");
      setTicketStatus("Open");
      setPriorityValue("Medium");
      setInternalNotes("");
      setMoreActionsOpen(false);
      return;
    }

    const subject = String(selectedEmail.subject || "").toLowerCase();
    const incomingPriority = String(selectedEmail.priority || "").toLowerCase();

    setAssignedAgent(selectedEmail.assignedAgent || "Unassigned");

    if (selectedEmail.folder === "resolved" || selectedEmail.folder === "processed") {
      setTicketStatus("Closed");
    } else if (!selectedEmail.isRead) {
      setTicketStatus("Open");
    } else {
      setTicketStatus("Pending");
    }

    if (incomingPriority === "high" || subject.includes("urgent") || subject.includes("asap")) {
      setPriorityValue("High");
    } else if (incomingPriority === "low") {
      setPriorityValue("Low");
    } else {
      setPriorityValue("Medium");
    }

    setInternalNotes(selectedEmail.internalNotes || "");
    setMoreActionsOpen(false);
    setShowQuotedContent(false);
  }, [selectedEmail]);

  const pages = Math.ceil(total / limit);
  const startItem = total === 0 ? 0 : (page - 1) * limit + 1;
  const endItem = Math.min(page * limit, total);

  const handleSelectAll = () => {
    setSelectedEmails((prev) =>
      prev.length === emails.length ? [] : emails.map((e) => e._id)
    );
  };

  const handleSelectOne = (id) => {
    setSelectedEmails((prev) =>
      prev.includes(id) ? prev.filter((e) => e !== id) : [...prev, id]
    );
  };

  const isSelected = (id) => selectedEmails.includes(id);

  const priorityColor = (priority) => {
    const p = (priority || "pending").toLowerCase();
    if (p === "high") return "bg-red-100 text-red-800 border-red-200";
    if (p === "medium") return "bg-amber-100 text-amber-800 border-amber-200";
    if (p === "low") return "bg-emerald-100 text-emerald-800 border-emerald-200";
    return "bg-slate-100 text-slate-700 border-slate-200";
  };

  const statusTone = (status) => {
    const value = String(status || "").toLowerCase();
    if (value === "open" || value === "urgent" || value === "high") {
      return "bg-red-50 text-red-700 border-red-200";
    }
    if (value === "pending" || value === "medium") {
      return "bg-amber-50 text-amber-700 border-amber-200";
    }
    if (value === "closed" || value === "resolved" || value === "processed" || value === "low") {
      return "bg-emerald-50 text-emerald-700 border-emerald-200";
    }
    return "bg-slate-100 text-slate-700 border-slate-200";
  };

  const deriveMessageStatus = useCallback(
    (email) => {
      const subject = String(email?.subject || "").toLowerCase();
      if (String(email?.priority || "").toLowerCase() === "high" || subject.includes("urgent") || subject.includes("asap")) {
        return "Urgent";
      }
      if (email?.folder === "resolved" || email?.folder === "processed") {
        return "Resolved";
      }
      if (email?.isRead) {
        return "Pending";
      }
      return "Pending";
    },
    []
  );

  const selectedCountLabel =
    selectedEmails.length > 0
      ? `${selectedEmails.length} selected`
      : `${startItem}-${endItem} of ${total}`;

  const renderPriorityBadge = (priority) => {
    if (!priority || String(priority).toLowerCase() === "pending") return null;

    return (
      <span
        className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-semibold border ${priorityColor(
          priority
        )}`}
      >
        {String(priority).toUpperCase()}
      </span>
    );
  };

  const currentListLabel = useMemo(() => {
    return FOLDER_LABELS[folder] || "Inbox";
  }, [folder]);

  const changeFolder = useCallback(
    (nextFolder) => {
      setSelectedEmails([]);
      setSelectedEmail(null);
      setFolder(nextFolder);
      setPage(1);
      setSearchParams(
        {
          folder: nextFolder,
          page: "1",
          ...(searchTerm && { q: searchTerm }),
        },
        { replace: true }
      );
    },
    [searchTerm, setSearchParams]
  );

  const openTicketFromEmail = useCallback(
    (email) => {
      const resolvedTicketId =
        email?.ticketId ||
        email?.metadata?.ticketId ||
        extractTicketIdFromSubject(email?.subject);

      if (!resolvedTicketId) {
        toast.info("No linked ticket was found for this message yet.");
        return;
      }

      if (!email.isRead) {
        handleMarkRead(email._id, true);
      }

      navigate(`/portal/tickets/${resolvedTicketId}`);
    },
    [handleMarkRead, navigate]
  );

  const openThreadFromEmail = useCallback(
    async (email) => {
      const explicitThreadId =
        typeof email?.threadId === "string"
          ? email.threadId
          : (email?.threadId?._id || null);

      if (explicitThreadId) {
        if (!email?.isRead && email?._id) {
          handleMarkRead(email._id, true);
        }

        navigate(`/portal/messages?threadId=${explicitThreadId}`);
        return;
      }

      const sourceCaseId = extractSourceCaseIdFromEmail(email);
      if (!sourceCaseId) {
        toast.info("No linked thread was found for this email yet.");
        return;
      }

      try {
        const thread = await getThreadBySourceCaseId(fetchWithAuth, sourceCaseId);
        if (!thread?._id) {
          toast.info("No linked thread was found for this application yet.");
          return;
        }

        if (!email?.isRead && email?._id) {
          handleMarkRead(email._id, true);
        }

        navigate(`/portal/messages?threadId=${thread._id}`);
      } catch (error) {
        toast.error(error.message || "Failed to open thread");
      }
    },
    [fetchWithAuth, handleMarkRead, navigate]
  );

  if (sessionLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" />
        <p className="ml-2">Loading session...</p>
      </div>
    );
  }

  if (!imap_enabled) {
    return <Navigate to="/portal" replace />;
  }

  // ------------------------------------------------------------------
  // RENDER
  // ------------------------------------------------------------------
  return (
    <div className="flex h-[calc(100vh-12rem)] min-h-[680px] flex-col">
      <div className="border-b border-slate-200 bg-white px-4 py-4">
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between gap-4">
            <h1 className="text-2xl font-semibold text-slate-950">Inbox</h1>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={openCompose}
                className="inline-flex items-center rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800"
              >
                <Send className="mr-2 h-4 w-4" />
                Compose
              </button>
              <button
                onClick={handleRefresh}
                disabled={loading}
                className="inline-flex items-center rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50 disabled:opacity-50"
              >
                <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
                Refresh
              </button>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {HEADER_FILTERS.map((item) => {
              const active = folder === item.folder;
              return (
                <button
                  key={item.folder}
                  type="button"
                  onClick={() => changeFolder(item.folder)}
                  className={classNames(
                    "inline-flex items-center rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                    active
                      ? "bg-slate-900 text-white"
                      : "text-slate-600 hover:bg-slate-100"
                  )}
                >
                  {item.title}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <Dialog open={composeOpen} onOpenChange={setComposeOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{composeMode === "reply" ? "Reply" : "Compose mail"}</DialogTitle>
            <DialogDescription>
              Send mail directly from the portal mailbox.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">To</label>
              <input
                type="email"
                value={composeForm.to}
                onChange={(event) => handleComposeChange("to", event.target.value)}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                placeholder="recipient@example.com"
              />
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Subject</label>
              <input
                type="text"
                value={composeForm.subject}
                onChange={(event) => handleComposeChange("subject", event.target.value)}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                placeholder="Subject"
              />
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Message</label>
              <Textarea
                value={composeForm.body}
                onChange={(event) => handleComposeChange("body", event.target.value)}
                className="min-h-[240px]"
                placeholder="Write your email..."
              />
            </div>
          </div>

          <DialogFooter>
            <button
              type="button"
              onClick={() => setComposeOpen(false)}
              className="inline-flex items-center rounded-md border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleComposeSend}
              disabled={composeSending}
              className="inline-flex items-center rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
            >
              <Send className="mr-2 h-4 w-4" />
              {composeSending ? "Sending..." : "Send"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="min-h-0 flex-1 bg-slate-50">
        <div className="grid h-full min-h-0 grid-cols-1 gap-6 xl:grid-cols-[380px_minmax(0,1fr)]">
          <section className="flex min-h-0 flex-col bg-white">
            <div className="border-b border-slate-200 px-4 py-4">
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm font-semibold text-slate-900">
                  {selectedCountLabel}
                </div>
                <div className="flex items-center gap-1 text-slate-500">
                  <button
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page === 1}
                    className="rounded p-1 hover:bg-slate-100 disabled:opacity-40"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  <span className="px-1 text-xs">
                    {page} / {Math.max(pages, 1)}
                  </span>
                  <button
                    onClick={() => setPage((p) => Math.min(pages, p + 1))}
                    disabled={page === pages || pages === 0}
                    className="rounded p-1 hover:bg-slate-100 disabled:opacity-40"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              </div>

              <div className="mt-4 flex items-center gap-2">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input
                    placeholder="Search sender or subject"
                    defaultValue={searchTerm}
                    onChange={(e) => debouncedSearch(e.target.value)}
                    className="w-full rounded-md border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  />
                </div>
                <button
                  onClick={() => setUnreadOnly(!unreadOnly)}
                  className={classNames(
                    "inline-flex items-center rounded-md border px-3 py-2 text-xs font-medium transition-colors",
                    unreadOnly
                      ? "border-emerald-500 bg-emerald-50 text-emerald-700"
                      : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                  )}
                >
                  <Filter className="mr-1.5 h-3.5 w-3.5" />
                  Unread
                </button>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto">
              {loading ? (
                <div className="flex h-full flex-col items-center justify-center py-10 text-slate-500">
                  <div className="animate-spin rounded-full h-7 w-7 border-b-2 border-emerald-500" />
                  <p className="mt-2 text-xs">Loading emails…</p>
                </div>
              ) : emails.length === 0 ? (
                <div className="flex h-full flex-col items-center justify-center py-10 text-slate-500">
                  <Mail className="h-10 w-10 mb-3 text-slate-300" />
                  <p className="text-xs mb-1">No emails found.</p>
                  <button
                    onClick={handleRefresh}
                    className="text-xs text-emerald-600 hover:underline"
                  >
                    Fetch now?
                  </button>
                </div>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {emails.map((email) => {
                    const isActive = selectedEmail?._id === email._id;

                    return (
                      <li
                        key={email._id}
                        onClick={() => {
                          setSelectedEmail(email);
                          if (!email.isRead) {
                            handleMarkRead(email._id, true);
                          }
                        }}
                        className={classNames(
                          "cursor-pointer px-4 py-4 text-sm transition-colors",
                          isActive ? "bg-slate-50" : "hover:bg-slate-50"
                        )}
                      >
                        <div className="min-w-0">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div
                                className={classNames(
                                  "truncate text-sm",
                                  email.isRead ? "font-medium text-slate-700" : "font-semibold text-slate-950"
                                )}
                              >
                                {email.from || "Unknown sender"}
                              </div>
                              <div
                                className={classNames(
                                  "mt-1 truncate text-sm",
                                  email.isRead ? "text-slate-600" : "font-medium text-slate-900"
                                )}
                              >
                                {email.subject || "(no subject)"}
                              </div>
                            </div>
                            <div className="shrink-0 text-xs text-slate-500">
                              {email.date ? new Date(email.date).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : ""}
                            </div>
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </section>

          <section className="hidden min-h-0 flex-col bg-white xl:flex">
            {!selectedEmail ? (
              <div className="flex flex-1 items-center justify-center text-sm text-slate-400">
                Select an email to view it.
              </div>
            ) : (
              <>
                <div className="border-b border-slate-200 px-5 py-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="text-lg font-semibold text-slate-950">
                        {selectedEmail.subject || "(no subject)"}
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-slate-500">
                        <span className="font-medium text-slate-800">
                          {selectedEmail.from || "Unknown sender"}
                        </span>
                        <span>{extractEmailAddress(selectedEmail.from)}</span>
                        <span>•</span>
                        <span>
                          {selectedEmail.date
                            ? new Date(selectedEmail.date).toLocaleString()
                            : ""}
                        </span>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        onClick={() => handleReply(selectedEmail._id)}
                        className="inline-flex items-center rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800"
                      >
                        <Reply className="mr-2 h-4 w-4" />
                        Reply
                      </button>
                      <button
                        onClick={() => openThreadFromEmail(selectedEmail)}
                        disabled={!hasResolvableThreadLink(selectedEmail)}
                        className="inline-flex items-center rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-700 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400"
                      >
                        <MessageSquare className="mr-2 h-4 w-4" />
                        Open Thread
                      </button>
                      <button
                        onClick={() => handleMarkRead(selectedEmail._id, !selectedEmail.isRead)}
                        className="inline-flex items-center rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                      >
                        {selectedEmail.isRead ? "Mark Unread" : "Mark Read"}
                      </button>
                      <button
                        onClick={() => setMoreActionsOpen((current) => !current)}
                        className="inline-flex items-center rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                      >
                        <MoreHorizontal className="mr-2 h-4 w-4" />
                        More
                      </button>
                    </div>
                  </div>
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
                  {moreActionsOpen ? (
                    <div className="mb-4 flex flex-wrap gap-2 rounded-md bg-slate-50 p-3">
                      <button
                        type="button"
                        onClick={() => {
                          handleMove(selectedEmail._id, "processed");
                          setMoreActionsOpen(false);
                        }}
                        className="inline-flex items-center rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                      >
                        Move to Processed
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          openTicketFromEmail(selectedEmail);
                          setMoreActionsOpen(false);
                        }}
                        className="inline-flex items-center rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                      >
                        Open Ticket
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          openThreadFromEmail(selectedEmail);
                          setMoreActionsOpen(false);
                        }}
                        disabled={!hasResolvableThreadLink(selectedEmail)}
                        className="inline-flex items-center rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-400"
                      >
                        Open Thread
                      </button>
                    </div>
                  ) : null}

                  <div className="max-w-none space-y-3 text-sm text-slate-800">
                    {renderInboxBody(
                      selectedEmail.body,
                      showQuotedContent,
                      () => setShowQuotedContent((prev) => !prev)
                    )}
                  </div>

                  {selectedEmail.attachments && selectedEmail.attachments.length > 0 ? (
                    <div className="mt-8">
                      <div className="mb-3 text-sm font-semibold text-slate-900">Attachments</div>
                      <div className="space-y-2">
                        {selectedEmail.attachments.map((att, index) => (
                          <div
                            key={`${att.filename}-${index}`}
                            className="flex items-center justify-between rounded-md bg-slate-50 px-3 py-2"
                          >
                            <div className="flex items-center gap-2 text-sm text-slate-700">
                              <Paperclip className="h-4 w-4 text-slate-400" />
                              <span>{att.filename}</span>
                              <span className="text-xs text-slate-400">{att.size} bytes</span>
                            </div>
                            <a
                              href={att.url || "#"}
                              download={Boolean(att.url)}
                              onClick={(event) => {
                                if (!att.url) {
                                  event.preventDefault();
                                  toast.info("Attachment download is not available yet for this message");
                                }
                              }}
                              className="inline-flex items-center text-sm font-medium text-emerald-600 hover:text-emerald-700"
                            >
                              <Download className="mr-1 h-4 w-4" />
                              {att.url ? "Download" : "Unavailable"}
                            </a>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  <details className="mt-8 rounded-lg border border-slate-200 bg-slate-50 p-4">
                    <summary className="cursor-pointer text-sm font-medium text-slate-700">
                      Conversation details
                    </summary>
                    <div className="mt-4 space-y-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${statusTone(ticketStatus)}`}
                        >
                          {ticketStatus}
                        </span>
                        <span
                          className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold ${priorityColor(priorityValue)}`}
                        >
                          <Flag className="mr-1 h-3.5 w-3.5" />
                          {priorityValue}
                        </span>
                        <span className="inline-flex items-center rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-slate-700">
                          {assignedAgent}
                        </span>
                      </div>

                      <div>
                        <div className="mb-2 text-sm font-semibold text-slate-900">Internal Notes</div>
                        <textarea
                          value={internalNotes}
                          onChange={(event) => setInternalNotes(event.target.value)}
                          className="min-h-[140px] w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                          placeholder="Add internal context, follow-up notes, or handoff details."
                        />
                        <button
                          type="button"
                          onClick={() => toast.success("Internal note saved locally")}
                          className="mt-3 inline-flex items-center rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                        >
                          Save Note
                        </button>
                      </div>
                    </div>
                  </details>
                </div>
              </>
            )}
          </section>
        </div>
      </div>
    </div>
  );
};

export default Inbox;
