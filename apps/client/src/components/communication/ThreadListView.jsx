import React, { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { MessageSquare, Search } from "lucide-react";
import { toast } from "react-toastify";
import { useUser } from "../../store/session";
import { createOrOpenThread, getThreads } from "../../services/communication.service";
import { getThreadTitle } from "../../utils/threadTitle";

function formatTimestamp(value) {
  if (!value) return "No activity";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "No activity";
  return date.toLocaleString();
}

export default function ThreadListView({
  title,
  description,
  basePath,
  emptyLabel = "No threads found.",
}) {
  const { fetchWithAuth } = useUser();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [threads, setThreads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState(searchParams.get("q") || "");
  const [selectedThreadId, setSelectedThreadId] = useState("");
  const [denseMode, setDenseMode] = useState(localStorage.getItem("layoutDensity") !== "comfortable");

  useEffect(() => {
    const onStorage = () => setDenseMode(localStorage.getItem("layoutDensity") !== "comfortable");
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const loadThreads = async (sourceCaseId = "") => {
    try {
      setLoading(true);
      const nextThreads = await getThreads(fetchWithAuth, {
        sourceCaseId,
        includeMonitoring: true,
      });
      setThreads(nextThreads);
    } catch (error) {
      toast.error(error.message || "Failed to fetch threads");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadThreads(searchParams.get("q") || "");
  }, []);

  useEffect(() => {
    const q = searchParams.get("q") || "";
    setFilter(q);
  }, [searchParams]);

  const handleSearch = async () => {
    const nextQuery = filter.trim();
    setSearchParams(nextQuery ? { q: nextQuery } : {});
    await loadThreads(nextQuery);
  };

  const filteredThreads = threads.filter((thread) => {
    const query = filter.trim().toLowerCase();
    if (!query) return true;

    return [thread.subject, thread.sourceCaseId, thread.mailboxId?.name, thread.lastMessage]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(query));
  });

  const handleOpenExisting = () => {
    const selectedThread = threads.find((thread) => thread._id === selectedThreadId);
    if (!selectedThread?._id) {
      toast.error("Select an existing thread");
      return;
    }

    navigate(`${basePath}/messages?threadId=${selectedThread._id}`);
  };

  const handleOpenOrCreate = async () => {
    const nextFilter = filter.trim();

    if (!nextFilter) {
      toast.error("Enter an application ID to open a thread");
      return;
    }

    try {
      const { thread, created } = await createOrOpenThread(fetchWithAuth, {
        sourceCaseId: nextFilter,
      });

      if (!thread?._id) {
        throw new Error("Thread was not returned");
      }

      toast.success(created ? "Thread created" : "Thread opened");
      navigate(`${basePath}/messages?threadId=${thread._id}`);
    } catch (error) {
      console.error(error);
      toast.error(error.message || "Failed to open thread");
    }
  };

  return (
    <div className={denseMode ? "space-y-4" : "space-y-6"}>
      <div>
        <h1 className={denseMode ? "text-xl font-semibold text-slate-950" : "text-2xl font-semibold text-slate-950"}>{title}</h1>
        {description ? (
          <p className="mt-1 text-sm text-slate-500">{description}</p>
        ) : null}
      </div>

      <div className={denseMode ? "desk-v2-actionbar flex gap-2 rounded-lg p-1.5" : "flex gap-3"}>
        <label className="relative w-full max-w-md">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            className={denseMode ? "desk-v2-input w-full border border-slate-200 bg-white py-1 pl-9 pr-3 text-xs" : "w-full rounded-md border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm"}
            value={filter || ""}
            onChange={(event) => {
              setFilter(event.target.value);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                handleSearch();
              }
            }}
            placeholder="Search by application ID, subject, mailbox, or message"
          />
        </label>
        <button
          type="button"
          onClick={handleSearch}
          className={denseMode ? "desk-v2-btn border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50" : "rounded-md border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"}
        >
          Search
        </button>
        <button
          type="button"
          onClick={handleOpenOrCreate}
          className={denseMode ? "desk-v2-btn bg-slate-900 text-xs font-medium text-white hover:bg-slate-800" : "rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"}
        >
          Open or Create
        </button>
      </div>

      <div className={denseMode ? "flex gap-2" : "flex gap-3"}>
        <select
          className={denseMode ? "desk-v2-input w-full max-w-md border border-slate-200 bg-white px-3 py-1 text-xs" : "w-full max-w-md rounded-md border border-slate-200 bg-white px-3 py-2 text-sm"}
          value={selectedThreadId}
          onChange={(event) => {
            const nextThreadId = event.target.value;
            setSelectedThreadId(nextThreadId);
            if (nextThreadId) {
              navigate(`${basePath}/messages?threadId=${nextThreadId}`);
            }
          }}
        >
          <option value="">Select thread by application</option>
          {filteredThreads.map((thread) => (
            <option key={thread._id} value={thread._id}>
              {thread.sourceCaseId} - {getThreadTitle(thread)}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={handleOpenExisting}
          className={denseMode ? "desk-v2-btn border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50" : "rounded-md border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"}
        >
          Open Selected
        </button>
      </div>

      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        {loading ? (
          <div className="p-4 text-sm text-slate-500">Loading threads...</div>
        ) : threads.length === 0 ? (
          <div className="p-6 text-sm text-slate-500">{emptyLabel}</div>
        ) : filteredThreads.length === 0 ? (
          <div className="p-6 text-sm text-slate-500">No threads match your search.</div>
        ) : (
          <div className="divide-y divide-slate-200">
            {filteredThreads.map((thread) => (
              <Link
                key={thread._id}
                to={`${basePath}/messages?threadId=${thread._id}`}
                className={denseMode ? "desk-v2-row block px-3 py-2.5 transition-colors hover:bg-slate-50" : "block px-4 py-4 transition-colors hover:bg-slate-50"}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <div className="truncate font-medium text-slate-900">
                        {getThreadTitle(thread)}
                      </div>
                      {thread.unreadCount > 0 ? (
                        <span className="inline-flex min-w-6 items-center justify-center rounded-full bg-emerald-600 px-2 py-0.5 text-xs font-semibold text-white">
                          {thread.unreadCount}
                        </span>
                      ) : null}
                    </div>
                    <div className="mt-1 text-sm text-slate-500">
                      {thread.sourceCaseId}
                    </div>
                    <div className="mt-2 line-clamp-2 text-sm text-slate-600">
                      {thread.lastMessage || "No messages yet"}
                    </div>
                  </div>
                  <div className="shrink-0 text-xs text-slate-400">
                    {formatTimestamp(thread.lastMessageAt)}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>

      {!loading && threads.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-8 text-center">
          <MessageSquare className="mx-auto h-8 w-8 text-slate-300" />
          <p className="mt-3 text-sm text-slate-500">{emptyLabel}</p>
        </div>
      ) : null}
    </div>
  );
}
