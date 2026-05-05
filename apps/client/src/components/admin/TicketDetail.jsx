import React, { useMemo, useState } from "react";
import { Clock3, MessageSquareText, PencilLine, Send, Timer } from "lucide-react";

function getSlaTone(level) {
  if (level === "high") return "text-rose-700 bg-rose-50 border-rose-200";
  if (level === "medium") return "text-amber-700 bg-amber-50 border-amber-200";
  return "text-emerald-700 bg-emerald-50 border-emerald-200";
}

function formatTimeLeft(targetTime) {
  if (!targetTime) return "--";
  const ms = new Date(targetTime).getTime() - Date.now();
  if (ms <= 0) return "Breached";
  const minutes = Math.floor(ms / 60000);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}h ${m}m`;
}

export default function TicketDetail({
  ticket,
  comments,
  loading,
  onReply,
  onAddNote,
  typing = false,
}) {
  const [draftReply, setDraftReply] = useState("");
  const [draftNote, setDraftNote] = useState("");

  const timeline = useMemo(() => {
    if (!ticket) return [];
    return [
      { id: "created", at: ticket.createdAt, text: "Ticket created" },
      { id: "updated", at: ticket.updatedAt || ticket.createdAt, text: "Last updated" },
    ];
  }, [ticket]);

  if (loading) {
    return <div className="h-full min-h-[680px] animate-pulse rounded-xl border border-slate-200 bg-white" />;
  }

  if (!ticket) {
    return (
      <div className="flex h-full min-h-[680px] items-center justify-center rounded-xl border border-slate-200 bg-white text-sm text-slate-500">
        Select a ticket to view details.
      </div>
    );
  }

  return (
    <div className="grid h-full min-h-[680px] grid-rows-[auto_minmax(0,1fr)_auto] rounded-xl border border-slate-200 bg-white">
      <div className="border-b border-slate-200 p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">#{ticket.number}</div>
            <h2 className="mt-1 text-lg font-bold text-slate-900">{ticket.title}</h2>
            <div className="mt-2 flex flex-wrap gap-2 text-xs">
              <span className="rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5">Status: {ticket.isComplete ? "Closed" : "Open"}</span>
              <span className="rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5">Priority: {ticket.priority || "normal"}</span>
              <span className="rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5">Assignee: {ticket.assignedTo?.name || "Unassigned"}</span>
            </div>
          </div>
          <div className={`rounded-lg border px-2.5 py-1 text-xs font-semibold ${getSlaTone(ticket.slaRisk)}`}>
            <div className="inline-flex items-center gap-1"><Timer className="h-3.5 w-3.5" /> SLA {ticket.slaRisk || "low"}</div>
            <div className="mt-1">T-{formatTimeLeft(ticket.slaDueAt)}</div>
          </div>
        </div>
      </div>

      <div className="grid min-h-0 grid-cols-[minmax(0,1.7fr)_minmax(240px,1fr)]">
        <div className="min-h-0 border-r border-slate-200">
          <div className="border-b border-slate-200 px-4 py-2 text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">
            Conversation
          </div>
          <div className="h-[390px] overflow-y-auto p-4">
            {(comments || []).length === 0 ? (
              <p className="text-sm text-slate-500">No conversation yet.</p>
            ) : (
              <div className="space-y-3">
                {comments.map((comment, index) => {
                  const mine = Boolean(comment?.user?.id === ticket?.assignedTo?.id);
                  return (
                    <div key={comment._id || index} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                      <div className={`max-w-[78%] rounded-2xl px-3 py-2 text-sm ${mine ? "bg-emerald-600 text-white" : "bg-slate-100 text-slate-800"}`}>
                        <div className="mb-1 text-[11px] opacity-80">{comment.user?.name || "Agent"} · {new Date(comment.createdAt).toLocaleTimeString()}</div>
                        <div className="whitespace-pre-wrap">{comment.text}</div>
                        <div className="mt-1 text-[10px] opacity-75">Reply · Assign</div>
                      </div>
                    </div>
                  );
                })}
                {typing ? (
                  <div className="text-xs text-slate-500">Agent typing...</div>
                ) : null}
              </div>
            )}
          </div>
        </div>

        <div className="min-h-0">
          <div className="border-b border-slate-200 px-4 py-2 text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">
            Activity Timeline
          </div>
          <div className="h-[390px] overflow-y-auto p-4">
            <div className="space-y-3">
              {timeline.map((item) => (
                <div key={item.id} className="rounded-lg border border-slate-200 bg-slate-50 p-2.5 text-xs text-slate-600">
                  <div className="inline-flex items-center gap-1 font-semibold text-slate-700"><Clock3 className="h-3.5 w-3.5" /> {item.text}</div>
                  <div className="mt-1">{new Date(item.at).toLocaleString()}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-3 border-t border-slate-200 p-4 lg:grid-cols-2">
        <div>
          <label className="mb-1 inline-flex items-center gap-1 text-xs font-semibold uppercase tracking-[0.08em] text-slate-500"><Send className="h-3.5 w-3.5" /> Reply</label>
          <textarea className="h-20 w-full rounded-md border border-slate-200 px-2 py-1.5 text-sm" value={draftReply} onChange={(e) => setDraftReply(e.target.value)} />
          <button type="button" onClick={() => { if (draftReply.trim()) onReply(draftReply.trim()); setDraftReply(""); }} className="mt-2 rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700">Send Reply</button>
        </div>
        <div>
          <label className="mb-1 inline-flex items-center gap-1 text-xs font-semibold uppercase tracking-[0.08em] text-slate-500"><PencilLine className="h-3.5 w-3.5" /> Internal Note</label>
          <textarea className="h-20 w-full rounded-md border border-slate-200 px-2 py-1.5 text-sm" value={draftNote} onChange={(e) => setDraftNote(e.target.value)} />
          <button type="button" onClick={() => { if (draftNote.trim()) onAddNote(draftNote.trim()); setDraftNote(""); }} className="mt-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100">Add Note</button>
        </div>
      </div>
    </div>
  );
}

