import React, { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, MessageSquareText, Send, XCircle } from "lucide-react";
import CommunicationPanel from "./CommunicationPanel.jsx";

function riskTone(risk) {
  if (risk === "red") return "border-rose-200 bg-rose-50 text-rose-700";
  if (risk === "yellow") return "border-amber-200 bg-amber-50 text-amber-700";
  return "border-emerald-200 bg-emerald-50 text-emerald-700";
}

export default function ApplicationDetail({
  application,
  thread,
  messages,
  activeTab,
  onApprove,
  onReject,
  onRequestInfo,
  onSendMessage,
}) {
  const [tab, setTab] = useState("details");
  const [outboundText, setOutboundText] = useState("");
  const nextAction = useMemo(() => {
    if (!application) return "Select application";
    if (application.status === "Rejected") return "Escalate or archive";
    if (application.status === "Approved") return "Quality check and close";
    if (application.stage === "Validation") return "Finalize validation";
    if (application.stage === "ID") return "Verify submitted ID";
    return "Review basic details";
  }, [application]);

  useEffect(() => {
    if (activeTab && ["details", "workflow", "communication"].includes(activeTab)) {
      setTab(activeTab);
    }
  }, [activeTab]);

  if (!application) {
    return <div className="flex h-full min-h-[760px] items-center justify-center rounded-xl border border-slate-200 bg-white text-sm text-slate-500">Select an application to start verification.</div>;
  }

  return (
    <div className="grid h-full min-h-[760px] grid-rows-[auto_auto_minmax(0,1fr)] rounded-xl border border-slate-200 bg-white">
      <div className="border-b border-slate-200 px-4 py-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Application</div>
            <h2 className="text-lg font-bold text-slate-900">{application.sourceCaseId || `#${application.number}`}</h2>
            <div className="mt-1 text-xs text-slate-600">{application.applicantName || "Unknown Applicant"} · Stage {application.stage}</div>
          </div>
          <div className={`rounded-lg border px-2.5 py-1 text-xs font-semibold ${riskTone(application.risk)}`}>
            SLA {application.slaRemainingLabel}
          </div>
        </div>
        <div className="mt-2 flex flex-wrap gap-2 text-xs">
          <span className="rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5">Status: {application.status}</span>
          <span className="rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5">Priority: {application.priority}</span>
          <span className="rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5">Assigned: {application.assignedVerifier || "Unassigned"}</span>
          <span className="rounded-md border border-cyan-200 bg-cyan-50 px-2 py-0.5 text-cyan-700">Next Action: {nextAction}</span>
        </div>
      </div>

      <div className="border-b border-slate-200 bg-slate-50 px-3 py-2">
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={onApprove} className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700"><CheckCircle2 className="h-3.5 w-3.5" />Approve</button>
          <button type="button" onClick={onReject} className="inline-flex items-center gap-1 rounded-md bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-rose-700"><XCircle className="h-3.5 w-3.5" />Reject</button>
          <button type="button" onClick={onRequestInfo} className="inline-flex items-center gap-1 rounded-md border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-700 hover:bg-amber-100"><AlertTriangle className="h-3.5 w-3.5" />Request Info</button>
          <button type="button" onClick={() => { if (outboundText.trim()) { onSendMessage(outboundText.trim()); setOutboundText(""); } }} className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100"><Send className="h-3.5 w-3.5" />Send Message</button>
          <input value={outboundText} onChange={(e) => setOutboundText(e.target.value)} placeholder="Write reply..." className="ml-auto h-8 min-w-[240px] rounded-md border border-slate-200 px-2 text-xs" />
        </div>
      </div>

      <div className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)]">
        <div className="border-b border-slate-200 px-3 py-2">
          <div className="flex gap-2">
            {[
              ["details", "Details"],
              ["workflow", "Workflow"],
              ["communication", "Communication"],
            ].map(([key, label]) => (
              <button key={key} type="button" onClick={() => setTab(key)} className={`rounded-md px-2.5 py-1 text-xs font-semibold ${tab === key ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"}`}>
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="min-h-0 p-3">
          {tab === "details" ? (
            <div className="grid h-full min-h-0 gap-3 lg:grid-cols-2">
              <div className="rounded-lg border border-slate-200 p-3 text-sm">
                <div className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Applicant Data</div>
                <div className="mt-2 space-y-1 text-slate-700">
                  <div>Name: {application.applicantName || "-"}</div>
                  <div>Email: {application.email || "-"}</div>
                  <div>Client: {application.clientName || "-"}</div>
                </div>
              </div>
              <div className="rounded-lg border border-slate-200 p-3 text-sm">
                <div className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Documents</div>
                <div className="mt-2 text-slate-700">ID Proof · Address Proof · Supporting Attachments</div>
              </div>
            </div>
          ) : null}

          {tab === "workflow" ? (
            <div className="rounded-lg border border-slate-200 p-3 text-sm">
              <div className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Workflow Stages</div>
              <div className="mt-2 grid gap-2">
                {["Basic", "ID", "Validation"].map((stage) => (
                  <div key={stage} className={`rounded-md border px-2.5 py-2 ${application.stage === stage ? "border-emerald-300 bg-emerald-50" : "border-slate-200 bg-white"}`}>
                    <div className="font-semibold text-slate-800">{stage}</div>
                    <div className="text-xs text-slate-500">{application.stage === stage ? "Current stage" : "Completed / upcoming stage"}</div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {tab === "communication" ? (
            <CommunicationPanel application={application} thread={thread} messages={messages} />
          ) : null}
        </div>
      </div>
    </div>
  );
}
