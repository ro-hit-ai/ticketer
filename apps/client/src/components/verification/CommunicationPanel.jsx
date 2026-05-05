import React, { useMemo } from "react";
import { Activity, Mail, MessageCircle } from "lucide-react";

function timeLabel(value) {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleString();
}

export default function CommunicationPanel({ application, thread, messages = [] }) {
  const timeline = useMemo(() => {
    const systemItems = [
      {
        id: `sys-created-${application?._id}`,
        kind: "system",
        at: application?.createdAt,
        title: "Application created",
        body: `Application ${application?.sourceCaseId || application?.number || ""} entered workflow`,
      },
      {
        id: `sys-status-${application?._id}`,
        kind: "system",
        at: application?.updatedAt,
        title: "Last status update",
        body: `${application?.status || "Pending"} · Stage ${application?.stage || "Basic"}`,
      },
    ].filter((item) => item.at);

    const messageItems = (messages || []).map((message) => ({
      id: message._id || `${message.createdAt}-${message.body?.slice(0, 20)}`,
      kind: message.direction === "outbound" ? "agent" : "user",
      at: message.createdAt,
      title: message.sender?.name || message.sender?.email || "Participant",
      body: message.body || "",
    }));

    return [...systemItems, ...messageItems].sort((a, b) => new Date(a.at) - new Date(b.at));
  }, [application, messages]);

  return (
    <div className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] rounded-lg border border-slate-200">
      <div className="border-b border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">
        Communication Timeline
      </div>
      <div className="min-h-0 overflow-y-auto p-3">
        {!thread && timeline.length === 0 ? (
          <div className="text-sm text-slate-500">No communication events yet.</div>
        ) : (
          <div className="space-y-3">
            {timeline.map((item) => {
              const system = item.kind === "system";
              const mine = item.kind === "agent";
              return (
                <div key={item.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-[82%] rounded-2xl px-3 py-2 text-sm ${system ? "border border-slate-200 bg-slate-50 text-slate-700" : mine ? "bg-emerald-600 text-white" : "bg-slate-100 text-slate-800"}`}>
                    <div className="mb-1 flex items-center gap-1 text-[11px] opacity-85">
                      {system ? <Activity className="h-3.5 w-3.5" /> : mine ? <Mail className="h-3.5 w-3.5" /> : <MessageCircle className="h-3.5 w-3.5" />}
                      <span>{item.title}</span>
                    </div>
                    <div className="whitespace-pre-wrap">{item.body}</div>
                    <div className="mt-1 text-[10px] opacity-80">{timeLabel(item.at)}</div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

