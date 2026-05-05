import React, { useMemo } from "react";
import { Clock3 } from "lucide-react";

const SORT_PRIORITY = { High: 0, Normal: 1, Low: 2 };

export default function QueueView({
  applications,
  selectedId,
  selectedBulkIds,
  queueFilter,
  onQueueFilterChange,
  onSelect,
  onToggleBulk,
  onBulkApprove,
  onBulkReject,
}) {
  const filtered = useMemo(() => {
    const list = (applications || []).filter((app) => {
      if (queueFilter === "assigned") return Boolean(app.assignedVerifier);
      if (queueFilter === "unassigned") return !app.assignedVerifier;
      if (queueFilter === "pending") return app.status === "Pending";
      if (queueFilter === "clarification") return app.status === "Needs Clarification";
      if (queueFilter === "completed") return app.status === "Approved" || app.status === "Rejected";
      return true;
    });
    return list.sort((a, b) => {
      const p = (SORT_PRIORITY[a.priority] ?? 10) - (SORT_PRIORITY[b.priority] ?? 10);
      if (p !== 0) return p;
      return new Date(a.slaDueAt) - new Date(b.slaDueAt);
    });
  }, [applications, queueFilter]);

  return (
    <div className="grid h-full min-h-[760px] grid-rows-[auto_auto_minmax(0,1fr)] rounded-xl border border-slate-200 bg-white">
      <div className="border-b border-slate-200 px-3 py-2">
        <div className="flex flex-wrap gap-2">
          {[
            ["assigned", "Assigned to Me"],
            ["unassigned", "Unassigned"],
            ["pending", "Pending Review"],
            ["clarification", "Needs Clarification"],
            ["completed", "Completed"],
          ].map(([key, label]) => (
            <button key={key} type="button" onClick={() => onQueueFilterChange(key)} className={`rounded-md px-2.5 py-1 text-xs font-semibold ${queueFilter === key ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"}`}>
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="border-b border-slate-200 bg-slate-50 px-3 py-2">
        <div className="flex items-center gap-2">
          <button type="button" onClick={onBulkApprove} className="rounded-md bg-emerald-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-emerald-700">Bulk Approve</button>
          <button type="button" onClick={onBulkReject} className="rounded-md bg-rose-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-rose-700">Bulk Reject</button>
          <span className="ml-auto text-xs text-slate-500">{selectedBulkIds.length} selected</span>
        </div>
      </div>

      <div className="min-h-0 overflow-auto">
        <div className="min-w-[980px]">
          <div className="sticky top-0 z-10 grid grid-cols-[40px_120px_170px_120px_140px_100px_130px_130px_150px] border-b border-slate-200 bg-slate-50 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">
            <span />
            <span>App ID</span>
            <span>Applicant</span>
            <span>Stage</span>
            <span>Status</span>
            <span>Priority</span>
            <span>SLA</span>
            <span>Updated</span>
            <span>Verifier</span>
          </div>
          {filtered.map((app) => {
            const selected = selectedId === app._id;
            return (
              <button
                key={app._id}
                type="button"
                onClick={() => onSelect(app)}
                className={`grid w-full grid-cols-[40px_120px_170px_120px_140px_100px_130px_130px_150px] items-center border-b border-slate-100 px-3 py-2 text-left text-xs transition-colors ${selected ? "bg-emerald-50" : "hover:bg-slate-50"}`}
              >
                <span>
                  <input type="checkbox" checked={selectedBulkIds.includes(app._id)} onChange={(e) => { e.stopPropagation(); onToggleBulk(app._id); }} />
                </span>
                <span className="font-mono text-slate-700">{app.sourceCaseId || `#${app.number}`}</span>
                <span className="truncate text-slate-700">{app.applicantName || "Unknown"}</span>
                <span className="text-slate-600">{app.stage}</span>
                <span className="text-slate-600">{app.status}</span>
                <span className={`${app.priority === "High" ? "text-rose-700" : app.priority === "Low" ? "text-sky-700" : "text-amber-700"} font-semibold`}>{app.priority}</span>
                <span className={`inline-flex items-center gap-1 font-semibold ${app.risk === "red" ? "text-rose-700" : app.risk === "yellow" ? "text-amber-700" : "text-emerald-700"}`}><Clock3 className="h-3.5 w-3.5" />{app.slaRemainingLabel}</span>
                <span className="text-slate-500">{new Date(app.updatedAt || app.createdAt).toLocaleString()}</span>
                <span className="truncate text-slate-600">{app.assignedVerifier || "Unassigned"}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

