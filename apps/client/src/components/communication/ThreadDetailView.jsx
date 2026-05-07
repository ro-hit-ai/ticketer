import React, { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { ArrowLeft, Send } from "lucide-react";
import { toast } from "react-toastify";
import { useUser } from "../../store/session";
import { getThreadFull, getThreadWorkflow, sendMessage } from "../../services/communication.service";
import { getThreadTitle } from "../../utils/threadTitle";

function formatTimestamp(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString();
}

function getSenderLabel(message) {
  return message?.sender?.name || message?.sender?.email || "Unknown sender";
}

function getDirectionTone(direction) {
  if (direction === "inbound") return "bg-slate-100 text-slate-700";
  if (direction === "internal") return "bg-amber-50 text-amber-700";
  return "bg-emerald-50 text-emerald-700";
}

function renderOwnerLabel(owner) {
  if (!owner) return "-";
  if (Array.isArray(owner)) {
    const activeOwners = owner
      .filter((item) => item && (item.name || item.groupKey))
      .map((item) => `${item.groupKey || "Group"}: ${item.name || "Unassigned"}`);
    return activeOwners.length ? activeOwners.join(", ") : "-";
  }

  return owner.name || "-";
}

function formatTatLabel(tatConfig) {
  if (!tatConfig?.clientInternalTatDays) return "Not available";
  const suffix = tatConfig.clientInternalTatDays === 1 ? "day" : "days";
  if (!tatConfig.weekendRules) {
    return `${tatConfig.clientInternalTatDays} ${suffix}`;
  }

  return `${tatConfig.clientInternalTatDays} ${suffix} (${tatConfig.weekendRules})`;
}

function resolveReplyRecipient(thread, workflow) {
  if (thread?.applicantEmail) {
    return thread.applicantEmail;
  }

  if (workflow?.candidateEmail) {
    return workflow.candidateEmail;
  }

  return null;
}

function stringifyValue(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeWorkflowPayload(fullPayload, workflowPayload) {
  const candidate =
    fullPayload?.workflow ||
    workflowPayload ||
    fullPayload?.thread?.workflowSnapshot ||
    fullPayload?.thread?.metadata?.workflowSnapshot ||
    fullPayload?.thread?.metadata?.workflow_snapshot ||
    fullPayload?.thread?.metadata?.workflow ||
    null;

  if (!candidate) return null;

  return {
    currentStage: candidate.currentStage || candidate.stage || candidate.rawCaseStatus || null,
    rawCaseStatus: candidate.rawCaseStatus || candidate.status || candidate.currentStage || null,
    ownerSummary: candidate.ownerSummary || candidate.owners || {},
    pendingItemsSummary:
      candidate.pendingItemsSummary || {
        pendingCount: candidate.pendingCount || 0,
        holdCount: candidate.holdCount || 0,
      },
    tatConfig:
      candidate.tatConfig || {
        clientInternalTatDays: candidate.clientInternalTatDays || null,
        weekendRules: candidate.weekendRules || null,
      },
    lastTimelineEvent: candidate.lastTimelineEvent || null,
    candidateEmail: candidate.candidateEmail || fullPayload?.thread?.applicantEmail || null,
  };
}

function renderEmailBody(body) {
  const text = String(body || "").replace(/\r\n/g, "\n");
  const lines = text.split("\n");
  const blocks = [];
  let normal = [];
  let quoted = [];

  const pushNormal = () => {
    if (normal.length) {
      blocks.push({ type: "normal", lines: normal });
      normal = [];
    }
  };

  const pushQuoted = () => {
    if (quoted.length) {
      blocks.push({ type: "quoted", lines: quoted.map((line) => line.replace(/^\s*>+\s?/, "")) });
      quoted = [];
    }
  };

  lines.forEach((line) => {
    const isQuoted = /^\s*>/.test(line);
    if (isQuoted) {
      pushNormal();
      quoted.push(line);
    } else {
      pushQuoted();
      normal.push(line);
    }
  });
  pushNormal();
  pushQuoted();

  return blocks.map((block, index) => {
    if (block.type === "quoted") {
      return (
        <div key={`q-${index}`} className="mt-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-500">Previous message</div>
          <div className="whitespace-pre-wrap">{block.lines.join("\n").trim()}</div>
        </div>
      );
    }

    const value = block.lines.join("\n").trim();
    if (!value) return null;
    return (
      <div key={`n-${index}`} className="whitespace-pre-wrap text-sm text-slate-700">
        {value}
      </div>
    );
  });
}

export default function ThreadDetailView({ backTo, backLabel }) {
  const location = useLocation();
  const queryParams = new URLSearchParams(location.search);
  const threadId = queryParams.get("threadId");
  const { fetchWithAuth, user } = useUser();
  const [thread, setThread] = useState(null);
  const [messages, setMessages] = useState([]);
  const [workflow, setWorkflow] = useState(null);
  const [body, setBody] = useState("");
  const [sendMode, setSendMode] = useState("external");
  const [manualEmail, setManualEmail] = useState("");
  const [internalRecipientEmail, setInternalRecipientEmail] = useState("");
  const [internalRecipientUserId, setInternalRecipientUserId] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [denseMode, setDenseMode] = useState(localStorage.getItem("layoutDensity") !== "comfortable");
  const replyRecipient = resolveReplyRecipient(thread, workflow);
  const canUseInternalRouting = Boolean(user?.isAgent || user?.isAdmin);
  const defaultInternalUserId =
    stringifyValue(thread?.workflowSnapshot?.currentUserId) ||
    stringifyValue(thread?.lastAssignedUserId) ||
    "";
  const effectiveRecipientLabel =
    sendMode === "internal"
      ? internalRecipientEmail || internalRecipientUserId || "No internal recipient selected"
      : replyRecipient || manualEmail || "No recipient available for this thread";

  const loadThread = async () => {
    if (!threadId) {
      setThread(null);
      setMessages([]);
      setWorkflow(null);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      const data = await getThreadFull(fetchWithAuth, threadId);
      setThread(data.thread);
      setMessages(data.messages);
      let workflowFromEndpoint = null;
      try {
        workflowFromEndpoint = await getThreadWorkflow(fetchWithAuth, threadId);
      } catch {
        workflowFromEndpoint = null;
      }
      setWorkflow(normalizeWorkflowPayload(data, workflowFromEndpoint));
      setInternalRecipientUserId((current) => current || data.thread?.workflowSnapshot?.currentUserId || data.thread?.lastAssignedUserId || "");
    } catch (error) {
      toast.error(error.message || "Failed to fetch thread");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadThread();
  }, [threadId]);
  useEffect(() => {
    const onStorage = () => setDenseMode(localStorage.getItem("layoutDensity") !== "comfortable");
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const handleSend = async (event) => {
    event.preventDefault();
    if (!body.trim() || !thread?._id) return;
    if (sendMode === "external" && !replyRecipient && !manualEmail.trim()) return;
    if (sendMode === "internal" && !internalRecipientEmail.trim() && !internalRecipientUserId.trim()) return;

    try {
      setSending(true);
      const externalRecipients = (replyRecipient || manualEmail)
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);

      await sendMessage(fetchWithAuth, {
        threadId: thread._id,
        body: body.trim(),
        direction: sendMode === "internal" ? "internal" : "outbound",
        channel: "email",
        recipients:
          sendMode === "external"
            ? externalRecipients.length > 0
              ? {
                  to: externalRecipients,
                  cc: [],
                  bcc: [],
                }
              : undefined
            : internalRecipientEmail.trim()
              ? {
                  to: internalRecipientEmail
                    .split(",")
                    .map((value) => value.trim())
                    .filter(Boolean),
                  cc: [],
                  bcc: [],
                }
              : undefined,
        recipientUserId: sendMode === "internal" ? internalRecipientUserId.trim() || undefined : undefined,
        recipientEmail: sendMode === "external" ? manualEmail.trim() || undefined : undefined,
        sender: {
          id: user?._id || null,
          name: user?.name || user?.email || "User",
          email: user?.email || null,
          type: user?._id ? "user" : "external",
        },
      });

      setBody("");
      if (sendMode === "internal") {
        setInternalRecipientEmail("");
      }
      if (sendMode === "external" && !replyRecipient) {
        setManualEmail("");
      }
      await loadThread();
      toast.success(sendMode === "internal" ? "Internal email sent" : "Reply sent");
    } catch (error) {
      toast.error(error.message || "Failed to send message");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className={denseMode ? "space-y-4" : "space-y-6"}>
      <div className="flex items-center gap-3">
        <Link
          to={backTo}
          className={denseMode ? "desk-v2-btn inline-flex items-center gap-2 border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50" : "inline-flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"}
        >
          <ArrowLeft className="h-4 w-4" />
          {backLabel}
        </Link>
      </div>

      {loading ? (
        <div className="rounded-lg border border-slate-200 bg-white p-6 text-sm text-slate-500">
          Loading thread...
        </div>
      ) : !threadId ? (
        <div className="rounded-lg border border-slate-200 bg-white p-6 text-sm text-slate-500">
          Select a thread to view messages.
        </div>
      ) : !thread ? (
        <div className="rounded-lg border border-slate-200 bg-white p-6 text-sm text-slate-500">
          Thread not found.
        </div>
      ) : (
        <>
          <div className={denseMode ? "grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(320px,1fr)]" : "grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(320px,1fr)]"}>
            <div className={denseMode ? "rounded-lg border border-slate-200 bg-white p-4" : "rounded-lg border border-slate-200 bg-white p-5"}>
              <div className="text-sm text-slate-500">{thread.sourceCaseId}</div>
              <h1 className={denseMode ? "desk-v2-title mt-1 text-slate-950" : "mt-1 text-2xl font-semibold text-slate-950"}>
                {getThreadTitle(thread)}
              </h1>
              <div className="mt-3 flex flex-wrap gap-4 text-sm text-slate-500">
                <span>Mailbox: {thread.mailboxId?.name || "-"}</span>
                <span>Last activity: {formatTimestamp(thread.lastMessageAt) || "No activity"}</span>
              </div>
            </div>

            <div className={denseMode ? "rounded-lg border border-slate-200 bg-white p-4" : "rounded-lg border border-slate-200 bg-white p-5"}>
              <div className="text-sm font-medium text-slate-500">Workflow Snapshot</div>
              {workflow ? (
                <div className="mt-4 space-y-4 text-sm">
                  <div>
                    <div className="text-xs uppercase tracking-wide text-slate-400">Status</div>
                    <div className="mt-1 inline-flex rounded-full bg-blue-50 px-3 py-1 text-sm font-medium text-blue-700">
                      {workflow.currentStage || workflow.rawCaseStatus || "Unknown"}
                    </div>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <div className="text-xs uppercase tracking-wide text-slate-400">Validator</div>
                      <div className="mt-1 text-slate-700">
                        {renderOwnerLabel(workflow.ownerSummary?.validator)}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs uppercase tracking-wide text-slate-400">Verifier</div>
                      <div className="mt-1 text-slate-700">
                        {renderOwnerLabel(workflow.ownerSummary?.verifier)}
                      </div>
                    </div>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <div className="text-xs uppercase tracking-wide text-slate-400">Pending Items</div>
                      <div className="mt-1 text-slate-700">
                        {workflow.pendingItemsSummary?.pendingCount || 0} pending
                        {workflow.pendingItemsSummary?.holdCount
                          ? `, ${workflow.pendingItemsSummary.holdCount} on hold`
                          : ""}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs uppercase tracking-wide text-slate-400">TAT</div>
                      <div className="mt-1 text-slate-700">{formatTatLabel(workflow.tatConfig)}</div>
                    </div>
                  </div>
                  <div>
                    <div className="text-xs uppercase tracking-wide text-slate-400">Last Workflow Event</div>
                    <div className="mt-1 text-slate-700">
                      {workflow.lastTimelineEvent?.message || "No workflow event available"}
                    </div>
                    {workflow.lastTimelineEvent?.at ? (
                      <div className="mt-1 text-xs text-slate-400">
                        {workflow.lastTimelineEvent.actorName
                          ? `${workflow.lastTimelineEvent.actorName} • `
                          : ""}
                        {formatTimestamp(workflow.lastTimelineEvent.at)}
                      </div>
                    ) : null}
                  </div>
                </div>
              ) : (
                <div className="mt-3 text-sm text-slate-500">
                  Workflow details are not available for this application yet.
                </div>
              )}
            </div>
          </div>

          <div className="rounded-lg border border-slate-200 bg-white">
            <div className={denseMode ? "border-b border-slate-200 px-4 py-3" : "border-b border-slate-200 px-5 py-4"}>
              <div className="text-lg font-medium text-slate-900">Conversation</div>
            </div>

            {messages.length === 0 ? (
              <div className="p-5 text-sm text-slate-500">No messages yet.</div>
            ) : (
              <div className="divide-y divide-slate-200">
                {messages.map((message) => (
                  <div key={message._id} className={denseMode ? "px-4 py-3" : "px-5 py-4"}>
                    <div className="flex items-center justify-between gap-4">
                      <div className="font-medium text-slate-900">
                        {getSenderLabel(message)}
                      </div>
                      <span
                        className={`rounded-full px-2 py-1 text-xs font-medium ${getDirectionTone(
                          message.direction
                        )}`}
                      >
                        {message.direction}
                      </span>
                    </div>
                    <div className="mt-1 text-xs text-slate-400">
                      {formatTimestamp(message.createdAt)}
                    </div>
                    <div className="mt-3 space-y-2">
                      {renderEmailBody(message.body)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <form onSubmit={handleSend} className={denseMode ? "rounded-lg border border-slate-200 bg-white p-4" : "rounded-lg border border-slate-200 bg-white p-5"}>
            <div className="text-lg font-medium text-slate-900">Reply</div>
            <div className="mt-2 text-sm text-slate-500">
              To: {effectiveRecipientLabel}
            </div>
            {sendMode === "external" && !replyRecipient ? (
              <label className="mt-4 block space-y-1">
                <span className="text-sm font-medium text-slate-700">Recipient Email</span>
                <input
                  className={denseMode ? "desk-v2-input w-full border border-slate-200 px-2.5 py-1 text-xs" : "w-full rounded-md border border-slate-200 px-3 py-2 text-sm"}
                  value={manualEmail}
                  onChange={(event) => setManualEmail(event.target.value)}
                  placeholder="Enter applicant email"
                />
              </label>
            ) : null}
            {canUseInternalRouting ? (
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <label className="block space-y-1">
                  <span className="text-sm font-medium text-slate-700">Send Mode</span>
                  <select
                    className={denseMode ? "desk-v2-input w-full border border-slate-200 px-2.5 py-1 text-xs" : "w-full rounded-md border border-slate-200 px-3 py-2 text-sm"}
                    value={sendMode}
                    onChange={(event) => setSendMode(event.target.value)}
                  >
                    <option value="external">External reply</option>
                    <option value="internal">Internal email</option>
                  </select>
                </label>

                {sendMode === "internal" ? (
                  <label className="block space-y-1">
                    <span className="text-sm font-medium text-slate-700">Recipient User Id</span>
                    <input
                      className={denseMode ? "desk-v2-input w-full border border-slate-200 px-2.5 py-1 text-xs" : "w-full rounded-md border border-slate-200 px-3 py-2 text-sm"}
                      value={internalRecipientUserId}
                      onChange={(event) => setInternalRecipientUserId(event.target.value)}
                      placeholder={defaultInternalUserId || "Internal user id"}
                    />
                  </label>
                ) : null}
              </div>
            ) : null}
            {canUseInternalRouting && sendMode === "internal" ? (
              <label className="mt-4 block space-y-1">
                <span className="text-sm font-medium text-slate-700">Recipient Emails</span>
                <input
                  className={denseMode ? "desk-v2-input w-full border border-slate-200 px-2.5 py-1 text-xs" : "w-full rounded-md border border-slate-200 px-3 py-2 text-sm"}
                  value={internalRecipientEmail}
                  onChange={(event) => setInternalRecipientEmail(event.target.value)}
                  placeholder="Optional explicit email override"
                />
              </label>
            ) : null}
            <textarea
              className={denseMode ? "mt-4 min-h-24 w-full rounded-md border border-slate-200 px-2.5 py-2 text-xs" : "mt-4 min-h-32 w-full rounded-md border border-slate-200 px-3 py-2 text-sm"}
              value={body}
              onChange={(event) => setBody(event.target.value)}
              placeholder="Write your message"
              required
            />
            <div className="mt-4">
              <button
                type="submit"
                disabled={
                  sending ||
                  !body.trim() ||
                  (sendMode === "external"
                    ? !replyRecipient && !manualEmail.trim()
                    : !internalRecipientEmail.trim() && !internalRecipientUserId.trim())
                }
                className={denseMode ? "desk-v2-btn inline-flex items-center bg-slate-900 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50" : "inline-flex items-center rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"}
              >
                <Send className="mr-2 h-4 w-4" />
                {sending ? "Sending..." : sendMode === "internal" ? "Send Internal Email" : "Send Reply"}
              </button>
            </div>
          </form>
        </>
      )}
    </div>
  );
}
