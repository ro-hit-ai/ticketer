import React, { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { toast } from "react-toastify";
import { useUser } from "../../store/session";
import { getThreads } from "../../services/communication.service";
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

  const updateSelectedThread = (threadId) => {
    setSearchParams(threadId ? { threadId } : {});
  };

  const loadThreads = async () => {
    try {
      setLoadingThreads(true);
      const nextThreads = await getThreads(fetchWithAuth, { includeMonitoring: true });
      setThreads(nextThreads);

      if (nextThreads.length === 0) {
        if (selectedThreadId) {
          setSearchParams({});
        }
        return;
      }

      const selectedExists = nextThreads.some((thread) => thread._id === selectedThreadId);
      if (!selectedThreadId || !selectedExists) {
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
    if (loadingThreads || threads.length === 0 || !selectedThreadId) return;
    const selectedExists = threads.some((thread) => thread._id === selectedThreadId);
    if (!selectedExists) {
      updateSelectedThread(threads[0]._id);
    }
  }, [loadingThreads, threads, selectedThreadId]);

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
    <div className="space-y-5">
      <div className="rounded-xl border border-slate-200 bg-white px-4 py-4 shadow-sm">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Messages</h1>
        <p className="mt-1 text-sm text-slate-600">
          Audit thread activity and review message history across the shared communication system.
        </p>
      </div>

      <div className="grid gap-4 xl:grid-cols-[360px_minmax(0,1fr)]">
        <aside className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="sticky top-0 z-10 border-b border-slate-200 bg-white px-4 py-3">
            <h2 className="text-base font-semibold text-slate-900">Thread Directory</h2>
            <p className="text-xs text-slate-500">Search and select a conversation thread.</p>
          </div>

          <div className="space-y-2 border-b border-slate-200 bg-slate-50/70 px-4 py-3">
            <input
              className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-0 placeholder:text-slate-400 focus:border-emerald-500"
              value={threadFilter}
              onChange={(event) => setThreadFilter(event.target.value)}
              placeholder="Search by subject, source case, mailbox"
            />

            <select
              className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-0 focus:border-emerald-500"
              value={selectedThreadId}
              onChange={(event) => updateSelectedThread(event.target.value)}
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
            <div className="p-4 text-sm text-slate-500">Loading threads...</div>
          ) : threads.length === 0 ? (
            <div className="p-4 text-sm text-slate-500">
              No threads found. <Link className="underline" to="/admin/threads">Create one first</Link>.
            </div>
          ) : filteredThreads.length === 0 ? (
            <div className="p-4 text-sm text-slate-500">
              No threads match your search.
            </div>
          ) : (
            <div className="h-[calc(100vh-430px)] min-h-[320px] divide-y divide-slate-100 overflow-y-auto">
              {filteredThreads.map((thread) => (
                <button
                  key={thread._id}
                  type="button"
                  onClick={() => updateSelectedThread(thread._id)}
                  className={`w-full px-4 py-3 text-left transition-colors ${
                    selectedThreadId === thread._id
                      ? "bg-emerald-50/70"
                      : "bg-white hover:bg-slate-50"
                  }`}
                >
                  <div className="truncate font-medium text-slate-900">{getThreadTitle(thread)}</div>
                  <div className="mt-1 text-xs text-slate-500">{thread.sourceCaseId}</div>
                  <div className="mt-1 text-xs text-slate-500">
                    {thread.mailboxId?.name || "No mailbox"}
                  </div>
                </button>
              ))}
            </div>
          )}
        </aside>

        <section className="space-y-4">
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="text-base font-semibold text-slate-900">Selected Thread</h2>
            {selectedThread ? (
              <div className="mt-3 space-y-2 text-sm text-slate-700">
                <div><span className="font-semibold text-slate-900">Subject:</span> {getThreadTitle(selectedThread)}</div>
                <div><span className="font-semibold text-slate-900">Source Case:</span> {selectedThread.sourceCaseId}</div>
                <div><span className="font-semibold text-slate-900">Mailbox:</span> {selectedThread.mailboxId?.name || "-"}</div>
                <div className="pt-2 flex gap-2">
                  <Link
                    to={`/admin/threads?threadId=${selectedThread._id}`}
                    className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
                  >
                    Open in Threads
                  </Link>
                  <button
                    type="button"
                    onClick={() => loadMessages(selectedThread._id)}
                    className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
                  >
                    Refresh Messages
                  </button>
                </div>
              </div>
            ) : (
              <div className="mt-2 text-sm text-slate-500">Select a thread to load messages.</div>
            )}
          </div>

          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="sticky top-0 z-10 border-b border-slate-200 bg-white px-4 py-3">
              <h2 className="text-base font-semibold text-slate-900">Message History</h2>
            </div>

            <div className="border-b border-slate-200 bg-slate-50/70 px-4 py-2.5 text-xs font-medium text-slate-600">
              Admin view only. Messaging is handled by validators.
            </div>

            {loadingMessages ? (
              <div className="p-4 text-sm text-slate-500">Loading messages...</div>
            ) : messages.length === 0 ? (
              <div className="p-4 text-sm text-slate-500">No messages for this thread yet.</div>
            ) : (
              <div className="h-[calc(100vh-470px)] min-h-[340px] space-y-3 overflow-y-auto bg-slate-50/50 p-4">
                {messages.map((message) => (
                  <article key={message._id} className="rounded-lg border border-slate-200 bg-white p-4">
                    <div className="flex items-center justify-between gap-4">
                      <div className="font-semibold text-slate-900">
                        {message.sender?.name || message.sender?.email || "Unknown sender"}
                      </div>
                      <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${
                        message.direction === "outbound"
                          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                          : "border-sky-200 bg-sky-50 text-sky-700"
                      }`}>
                        {message.direction === "outbound" ? "Sent" : "Received"}
                      </span>
                    </div>
                    <div className="mt-1 text-xs text-slate-500">
                      {new Date(message.createdAt).toLocaleString()}
                    </div>
                    {message.subject ? (
                      <div className="mt-2 text-sm font-semibold text-slate-800">{message.subject}</div>
                    ) : null}
                    <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-slate-700">
                      {message.body}
                    </p>
                  </article>
                ))}
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
