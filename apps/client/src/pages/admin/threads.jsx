import React, { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "react-toastify";
import { useUser } from "../../store/session";
import { getThreadTitle } from "../../utils/threadTitle";

export default function AdminThreads() {
  const { fetchWithAuth } = useUser();
  const navigate = useNavigate();
  const [threads, setThreads] = useState([]);
  const [filter, setFilter] = useState("");
  const [selectedThreadId, setSelectedThreadId] = useState("");
  const [loading, setLoading] = useState(true);

  const loadThreads = async (sourceCaseId = "") => {
    try {
      setLoading(true);
      const query = sourceCaseId.trim()
        ? `/v1/threads?sourceCaseId=${encodeURIComponent(sourceCaseId.trim())}`
        : "/v1/threads";
      const response = await fetchWithAuth(query, { method: "GET" });
      const data = await response.json();

      if (!response.ok || data.success === false) {
        throw new Error(data.message || "Failed to fetch threads");
      }

      setThreads(Array.isArray(data.threads) ? data.threads : []);
    } catch (error) {
      toast.error(error.message || "Failed to fetch threads");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadThreads();
  }, []);

  const handleSearch = async (event) => {
    event.preventDefault();
    await loadThreads(filter);
  };

  const filteredThreads = threads.filter((thread) => {
    const query = filter.trim().toLowerCase();
    if (!query) return true;

    return [thread.subject, thread.sourceCaseId, thread.mailboxId?.name, thread.status]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(query));
  });

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

      <div className="grid gap-6 xl:grid-cols-[360px_minmax(0,1fr)]">
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
                setSelectedThreadId(nextThreadId);
                if (nextThreadId) {
                  navigate(`/admin/messages?threadId=${nextThreadId}`);
                }
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
          <div className="border-b px-4 py-3">
            <h2 className="text-lg font-medium">Thread List</h2>
          </div>

          {loading ? (
            <div className="p-4 text-sm text-muted-foreground">Loading threads...</div>
          ) : threads.length === 0 ? (
            <div className="p-4 text-sm text-muted-foreground">No threads found.</div>
          ) : filteredThreads.length === 0 ? (
            <div className="p-4 text-sm text-muted-foreground">No threads match your filter.</div>
          ) : (
            <div className="max-h-[720px] divide-y overflow-y-auto">
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
                        setSelectedThreadId(thread._id);
                        navigate(`/admin/messages?threadId=${thread._id}`);
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
