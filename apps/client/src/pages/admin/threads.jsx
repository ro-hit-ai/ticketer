import React, { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "react-toastify";
import { useUser } from "../../store/session";
import { getThreads } from "../../services/communication.service";
import { getThreadTitle } from "../../utils/threadTitle";

export default function AdminThreads() {
  const { fetchWithAuth } = useUser();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [threads, setThreads] = useState([]);
  const [filter, setFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const selectedThreadId = searchParams.get("threadId") || "";

  const loadThreads = async (sourceCaseId = "") => {
    try {
      setLoading(true);
      const nextThreads = await getThreads(fetchWithAuth, {
        sourceCaseId: sourceCaseId.trim() || undefined,
        includeMonitoring: true,
      });
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
      setLoading(false);
    }
  };

  useEffect(() => {
    loadThreads();
  }, []);

  useEffect(() => {
    if (loading || threads.length === 0 || !selectedThreadId) return;
    const selectedExists = threads.some((thread) => thread._id === selectedThreadId);
    if (!selectedExists) {
      setSearchParams({ threadId: threads[0]._id });
    }
  }, [loading, threads, selectedThreadId]);

  const handleSearch = async (event) => {
    event.preventDefault();
    await loadThreads(filter);
  };

  const filteredThreads = useMemo(() => threads.filter((thread) => {
    const query = filter.trim().toLowerCase();
    if (!query) return true;

    return [thread.subject, thread.sourceCaseId, thread.mailboxId?.name, thread.status]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(query));
  }), [threads, filter]);

  const selectedThread =
    filteredThreads.find((thread) => thread._id === selectedThreadId) ||
    threads.find((thread) => thread._id === selectedThreadId) ||
    null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Threads</h1>
        <p className="text-sm text-muted-foreground">
          Review shared communication threads and jump into audit history.
        </p>
      </div>

      <div className="grid gap-4 xl:grid-cols-[360px_minmax(0,1fr)]">
        <div className="space-y-6">
          <div className="rounded-lg border bg-card p-4 text-sm text-muted-foreground">
            Admin view only. Messaging handled by validators.
          </div>

          <form onSubmit={handleSearch} className="rounded-lg border bg-card p-4 space-y-3">
            <h2 className="text-lg font-medium">Filter Threads</h2>
            <input
              className="w-full rounded-md border px-3 py-2 text-sm"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              placeholder="Search by sourceCaseId, subject, mailbox, status"
            />
            <select
              className="w-full rounded-md border px-3 py-2 text-sm"
              value={selectedThreadId}
              onChange={(event) => {
                const nextThreadId = event.target.value;
                setSearchParams(nextThreadId ? { threadId: nextThreadId } : {});
              }}
            >
              <option value="">Select from loaded threads</option>
              {filteredThreads.map((thread) => (
                <option key={thread._id} value={thread._id}>
                  {thread.sourceCaseId} - {getThreadTitle(thread)}
                </option>
              ))}
            </select>
            <button
              type="submit"
              className="rounded-md border px-4 py-2 text-sm font-medium"
            >
              Apply Filter
            </button>
            <button
              type="button"
              onClick={() => loadThreads(filter)}
              className="rounded-md border px-4 py-2 text-sm font-medium"
            >
              Refresh
            </button>
          </form>

          {selectedThread ? (
            <div className="rounded-lg border bg-card p-4 text-sm">
              <h2 className="text-lg font-medium">Selected Thread</h2>
              <div className="mt-2 space-y-1">
                <div><span className="font-medium">Subject:</span> {getThreadTitle(selectedThread)}</div>
                <div><span className="font-medium">Source Case:</span> {selectedThread.sourceCaseId}</div>
                <div><span className="font-medium">Status:</span> {selectedThread.status || "-"}</div>
                <div><span className="font-medium">Mailbox:</span> {selectedThread.mailboxId?.name || "-"}</div>
              </div>
              <div className="mt-3 flex gap-2">
                <Link
                  to={`/admin/messages?threadId=${selectedThread._id}`}
                  className="rounded-md border px-3 py-1.5 text-sm"
                >
                  View Messages
                </Link>
              </div>
            </div>
          ) : null}
        </div>

        <div className="rounded-lg border bg-card">
          <div className="sticky top-0 z-10 border-b bg-card px-4 py-3">
            <h2 className="text-lg font-medium">Thread List</h2>
          </div>

          {loading ? (
            <div className="p-4 text-sm text-muted-foreground">Loading threads...</div>
          ) : threads.length === 0 ? (
            <div className="p-4 text-sm text-muted-foreground">No threads found.</div>
          ) : filteredThreads.length === 0 ? (
            <div className="p-4 text-sm text-muted-foreground">No threads match your filter.</div>
          ) : (
            <div className="h-[calc(100vh-360px)] min-h-[460px] divide-y overflow-y-auto">
              {filteredThreads.map((thread) => (
                <div
                  key={thread._id}
                  className={`p-4 ${selectedThreadId === thread._id ? "bg-secondary/40" : ""}`}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="space-y-1">
                      <div className="font-medium">{getThreadTitle(thread)}</div>
                      <div className="text-sm text-muted-foreground">
                        sourceCaseId: {thread.sourceCaseId}
                      </div>
                    </div>
                    <span className="rounded-full border px-2 py-1 text-xs">{thread.status}</span>
                  </div>

                  <div className="mt-2 text-xs text-muted-foreground">
                    Mailbox: {thread.mailboxId?.name || "-"} | Channel: {thread.channel}
                  </div>

                  <div className="mt-3 flex gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setSearchParams({ threadId: thread._id });
                      }}
                      className="rounded-md border px-3 py-1.5 text-sm"
                    >
                      Select
                    </button>
                    <Link
                      to={`/admin/messages?threadId=${thread._id}`}
                      className="rounded-md border px-3 py-1.5 text-sm"
                    >
                      View Messages
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
