import React, { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { toast } from "react-toastify";
import { useUser } from "../../store/session";
import { getThreadTitle } from "../../utils/threadTitle";

export default function AdminMessages() {
  const { fetchWithAuth } = useUser();
  const [searchParams, setSearchParams] = useSearchParams();
  const [threads, setThreads] = useState([]);
  const [messages, setMessages] = useState([]);
  const [threadFilter, setThreadFilter] = useState("");
  const [loadingThreads, setLoadingThreads] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const selectedThreadId = searchParams.get("threadId") || "";
  const loadThreads = async () => {
    try {
      setLoadingThreads(true);
      const response = await fetchWithAuth("/v1/threads", { method: "GET" });
      const data = await response.json();

      if (!response.ok || data.success === false) {
        throw new Error(data.message || "Failed to fetch threads");
      }

      const nextThreads = Array.isArray(data.threads) ? data.threads : [];
      setThreads(nextThreads);

      if (!selectedThreadId && nextThreads[0]?._id) {
        setSearchParams({ threadId: nextThreads[0]._id });
      }
    } catch (error) {
      toast.error(error.message || "Failed to fetch threads");
    } finally {
      setLoadingThreads(false);
    }
  };

  const loadMessages = async (threadId) => {
    if (!threadId) {
      setMessages([]);
      return;
    }

    try {
      setLoadingMessages(true);
      const response = await fetchWithAuth(`/v1/messages/${threadId}`, { method: "GET" });
      const data = await response.json();

      if (!response.ok || data.success === false) {
        throw new Error(data.message || "Failed to fetch messages");
      }

      setMessages(Array.isArray(data.messages) ? data.messages : []);
    } catch (error) {
      toast.error(error.message || "Failed to fetch messages");
    } finally {
      setLoadingMessages(false);
    }
  };

  useEffect(() => {
    loadThreads();
  }, []);

  useEffect(() => {
    loadMessages(selectedThreadId);
  }, [selectedThreadId]);

  const selectedThread = threads.find((thread) => thread._id === selectedThreadId) || null;
  const filteredThreads = threads.filter((thread) => {
    const query = threadFilter.trim().toLowerCase();
    if (!query) return true;

    return [thread.subject, thread.sourceCaseId, thread.mailboxId?.name]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(query));
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Messages</h1>
        <p className="text-sm text-muted-foreground">
          Audit thread activity and review message history across the shared communication system.
        </p>
      </div>

      <div className="grid gap-6 xl:grid-cols-[320px_minmax(0,1fr)]">
        <div className="rounded-lg border bg-card">
          <div className="border-b px-4 py-3">
            <h2 className="text-lg font-medium">Threads</h2>
          </div>

          <div className="space-y-3 border-b px-4 py-3">
            <input
              className="w-full rounded-md border px-3 py-2 text-sm"
              value={threadFilter}
              onChange={(event) => setThreadFilter(event.target.value)}
              placeholder="Search by subject, source case, mailbox"
            />

            <select
              className="w-full rounded-md border px-3 py-2 text-sm"
              value={selectedThreadId}
              onChange={(event) => setSearchParams(event.target.value ? { threadId: event.target.value } : {})}
            >
              <option value="">Select a thread</option>
              {filteredThreads.map((thread) => (
                <option key={thread._id} value={thread._id}>
                  {getThreadTitle(thread)} - {thread.sourceCaseId}
                </option>
              ))}
            </select>
          </div>

          {loadingThreads ? (
            <div className="p-4 text-sm text-muted-foreground">Loading threads...</div>
          ) : threads.length === 0 ? (
            <div className="p-4 text-sm text-muted-foreground">
              No threads found. <Link className="underline" to="/admin/threads">Create one first</Link>.
            </div>
          ) : filteredThreads.length === 0 ? (
            <div className="p-4 text-sm text-muted-foreground">
              No threads match your search.
            </div>
          ) : (
            <div className="max-h-[420px] divide-y overflow-y-auto">
              {filteredThreads.map((thread) => (
                <button
                  key={thread._id}
                  type="button"
                  onClick={() => setSearchParams({ threadId: thread._id })}
                  className={`w-full px-4 py-3 text-left ${selectedThreadId === thread._id ? "bg-secondary" : ""}`}
                >
                  <div className="font-medium">{getThreadTitle(thread)}</div>
                  <div className="text-xs text-muted-foreground">{thread.sourceCaseId}</div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {thread.mailboxId?.name || "No mailbox"}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="space-y-6">
          <div className="rounded-lg border bg-card p-4">
            <h2 className="text-lg font-medium">Selected Thread</h2>
            {selectedThread ? (
              <div className="mt-2 space-y-1 text-sm">
                <div><span className="font-medium">Subject:</span> {getThreadTitle(selectedThread)}</div>
                <div><span className="font-medium">Source Case:</span> {selectedThread.sourceCaseId}</div>
                <div><span className="font-medium">Mailbox:</span> {selectedThread.mailboxId?.name || "-"}</div>
              </div>
            ) : (
              <div className="mt-2 text-sm text-muted-foreground">Select a thread to load messages.</div>
            )}
          </div>

          <div className="rounded-lg border bg-card">
            <div className="border-b px-4 py-3">
              <h2 className="text-lg font-medium">Message History</h2>
            </div>

            <div className="border-b bg-secondary/40 px-4 py-3 text-sm text-muted-foreground">
              Admin view only. Messaging is handled by validators.
            </div>

            {loadingMessages ? (
              <div className="p-4 text-sm text-muted-foreground">Loading messages...</div>
            ) : messages.length === 0 ? (
              <div className="p-4 text-sm text-muted-foreground">No messages for this thread yet.</div>
            ) : (
              <div className="divide-y">
                {messages.map((message) => (
                  <div key={message._id} className="p-4">
                    <div className="flex items-center justify-between gap-4">
                      <div className="font-medium">
                        {message.sender?.name || message.sender?.email || "Unknown sender"}
                      </div>
                      <span className="rounded-full border px-2 py-1 text-xs">
                        {message.direction === "outbound" ? "Sent" : "Received"}
                      </span>
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {new Date(message.createdAt).toLocaleString()}
                    </div>
                    {message.subject ? (
                      <div className="mt-2 text-sm font-medium">{message.subject}</div>
                    ) : null}
                    <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">
                      {message.body}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
