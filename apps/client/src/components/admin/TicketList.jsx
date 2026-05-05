import React, { useMemo, useRef, useState } from "react";
import { AlertTriangle, CircleDot, Search } from "lucide-react";

const ROW_HEIGHT = 54;
const OVERSCAN = 8;

function toneForPriority(priority) {
  const value = String(priority || "normal").toLowerCase();
  if (value === "high") return "text-rose-700";
  if (value === "low") return "text-sky-700";
  return "text-amber-700";
}

function toneForStatus(ticket) {
  if (ticket?.isComplete) return "bg-slate-400";
  if (ticket?.slaRisk === "high") return "bg-rose-500";
  if (ticket?.slaRisk === "medium") return "bg-amber-500";
  return "bg-emerald-500";
}

export default function TicketList({
  tickets,
  loading,
  selectedTicketId,
  onSelect,
  filters,
  onFiltersChange,
  onSearchFocus,
}) {
  const containerRef = useRef(null);
  const [scrollTop, setScrollTop] = useState(0);

  const filteredTickets = useMemo(() => {
    const query = (filters.search || "").trim().toLowerCase();
    return tickets.filter((ticket) => {
      const statusOk = filters.status === "all" || (filters.status === "closed" ? ticket.isComplete : !ticket.isComplete);
      const assigneeOk =
        filters.assignee === "all" ||
        (filters.assignee === "unassigned" ? !ticket.assignedTo?.name : Boolean(ticket.assignedTo?.name));
      const priorityOk = filters.priority === "all" || String(ticket.priority || "normal").toLowerCase() === filters.priority;
      const searchOk =
        !query ||
        [ticket.title, ticket.number, ticket.assignedTo?.name, ticket.clientId?.name]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(query));
      return statusOk && assigneeOk && priorityOk && searchOk;
    });
  }, [tickets, filters]);

  const viewportHeight = 560;
  const total = filteredTickets.length;
  const startIndex = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const endIndex = Math.min(total, Math.ceil((scrollTop + viewportHeight) / ROW_HEIGHT) + OVERSCAN);
  const visible = filteredTickets.slice(startIndex, endIndex);
  const topSpacer = startIndex * ROW_HEIGHT;
  const bottomSpacer = Math.max(0, (total - endIndex) * ROW_HEIGHT);

  return (
    <div className="flex h-full min-h-[680px] flex-col rounded-xl border border-slate-200 bg-white">
      <div className="sticky top-0 z-10 border-b border-slate-200 bg-white px-3 py-2">
        <div className="flex flex-wrap items-center gap-2">
          <label className="relative min-w-[220px] flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input
              value={filters.search}
              onChange={(e) => onFiltersChange({ ...filters, search: e.target.value })}
              onFocus={onSearchFocus}
              placeholder="Search tickets"
              className="h-8 w-full rounded-md border border-slate-200 pl-8 pr-2 text-xs outline-none ring-emerald-200 focus:ring-2"
            />
          </label>
          <select className="h-8 rounded-md border border-slate-200 px-2 text-xs" value={filters.status} onChange={(e) => onFiltersChange({ ...filters, status: e.target.value })}>
            <option value="all">All status</option>
            <option value="open">Open</option>
            <option value="closed">Closed</option>
          </select>
          <select className="h-8 rounded-md border border-slate-200 px-2 text-xs" value={filters.priority} onChange={(e) => onFiltersChange({ ...filters, priority: e.target.value })}>
            <option value="all">All priority</option>
            <option value="high">High</option>
            <option value="normal">Normal</option>
            <option value="low">Low</option>
          </select>
          <select className="h-8 rounded-md border border-slate-200 px-2 text-xs" value={filters.assignee} onChange={(e) => onFiltersChange({ ...filters, assignee: e.target.value })}>
            <option value="all">All assignees</option>
            <option value="unassigned">Unassigned</option>
            <option value="assigned">Assigned</option>
          </select>
        </div>
        <div className="mt-2 flex items-center justify-between text-[11px] text-slate-500">
          <span>{filteredTickets.length} tickets</span>
          <span className="inline-flex items-center gap-1"><AlertTriangle className="h-3.5 w-3.5 text-amber-500" /> SLA monitor active</span>
        </div>
      </div>

      <div className="grid grid-cols-[80px_minmax(220px,1.6fr)_100px_90px_130px_140px] border-b border-slate-200 bg-slate-50 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">
        <span>ID</span>
        <span>Subject</span>
        <span>Status</span>
        <span>Priority</span>
        <span>Assignee</span>
        <span>Updated</span>
      </div>

      <div
        ref={containerRef}
        onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
        className="h-[560px] overflow-y-auto"
      >
        {loading ? (
          <div className="space-y-2 p-3">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-10 animate-pulse rounded-md bg-slate-100" />
            ))}
          </div>
        ) : (
          <div>
            {topSpacer > 0 ? <div style={{ height: topSpacer }} /> : null}
            {visible.map((ticket) => {
              const selected = selectedTicketId === ticket._id;
              return (
                <button
                  key={ticket._id}
                  type="button"
                  onClick={() => onSelect(ticket)}
                  className={`grid w-full grid-cols-[80px_minmax(220px,1.6fr)_100px_90px_130px_140px] items-center border-b border-slate-100 px-3 text-left text-xs transition-colors ${selected ? "bg-emerald-50" : "hover:bg-slate-50"}`}
                  style={{ height: ROW_HEIGHT }}
                >
                  <span className="font-mono text-slate-600">#{ticket.number}</span>
                  <span className="truncate pr-3 font-medium text-slate-800">{ticket.title}</span>
                  <span className="inline-flex items-center gap-1.5 text-slate-600">
                    <span className={`h-2 w-2 rounded-full ${toneForStatus(ticket)}`} />
                    {ticket.isComplete ? "Closed" : "Open"}
                  </span>
                  <span className={`font-semibold capitalize ${toneForPriority(ticket.priority)}`}>{ticket.priority || "normal"}</span>
                  <span className="truncate text-slate-600">{ticket.assignedTo?.name || "Unassigned"}</span>
                  <span className="text-slate-500">{new Date(ticket.updatedAt || ticket.createdAt).toLocaleString()}</span>
                </button>
              );
            })}
            {bottomSpacer > 0 ? <div style={{ height: bottomSpacer }} /> : null}
          </div>
        )}
      </div>
      <div className="border-t border-slate-200 px-3 py-2 text-[11px] text-slate-500">
        <span className="inline-flex items-center gap-1"><CircleDot className="h-3.5 w-3.5 text-emerald-500" /> Live queue updates every 30s</span>
      </div>
    </div>
  );
}
