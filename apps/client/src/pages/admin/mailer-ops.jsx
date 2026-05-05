import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "react-toastify";
import { useUser } from "../../store/session";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

function MetricCard({ label, value, tone = "text-slate-900" }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
      <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">{label}</div>
      <div className={`mt-1 text-xl font-extrabold ${tone}`}>{value}</div>
    </div>
  );
}

export default function MailerOpsPage() {
  const { fetchWithAuth } = useUser();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [retryingId, setRetryingId] = useState(null);
  const [dashboard, setDashboard] = useState(null);
  const [deadJobs, setDeadJobs] = useState([]);
  const [auditLogs, setAuditLogs] = useState([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditPagination, setAuditPagination] = useState({ page: 1, limit: 20, total: 0, totalPages: 1 });
  const [auditFilters, setAuditFilters] = useState({
    eventType: "",
    entityId: "",
    startDate: "",
    endDate: "",
  });

  const load = async () => {
    setLoading(true);
    try {
      const [metricsRes, jobsRes] = await Promise.all([
        fetchWithAuth("/v1/monitoring/mailer?windowHours=24"),
        fetchWithAuth("/v1/email-queue/jobs?status=dead&limit=100"),
      ]);

      if (!metricsRes.ok) throw new Error(`Metrics request failed: ${metricsRes.status}`);
      if (!jobsRes.ok) throw new Error(`Dead jobs request failed: ${jobsRes.status}`);

      const metricsJson = await metricsRes.json();
      const jobsJson = await jobsRes.json();
      setDashboard(metricsJson);
      setDeadJobs(Array.isArray(jobsJson.jobs) ? jobsJson.jobs : []);
    } catch (error) {
      toast.error(`Failed to load mailer operations: ${error.message}`);
      if (String(error.message || "").toLowerCase().includes("session")) {
        navigate("/auth/login");
      }
    } finally {
      setLoading(false);
    }
  };

  const retryJob = async (jobId) => {
    try {
      setRetryingId(jobId);
      const response = await fetchWithAuth(`/v1/email-queue/jobs/${jobId}/retry`, {
        method: "POST",
      });
      const result = await response.json();
      if (!response.ok || result.success === false) {
        throw new Error(result.message || "Retry failed");
      }
      toast.success("Job re-queued for retry");
      await load();
    } catch (error) {
      toast.error(`Retry failed: ${error.message}`);
    } finally {
      setRetryingId(null);
    }
  };

  const fetchAuditLogs = async (page = 1, nextFilters = auditFilters) => {
    setAuditLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("page", String(page));
      params.set("limit", String(auditPagination.limit || 20));
      if (nextFilters.eventType) params.set("eventType", nextFilters.eventType);
      if (nextFilters.entityId) params.set("entityId", nextFilters.entityId);
      if (nextFilters.startDate) params.set("startDate", nextFilters.startDate);
      if (nextFilters.endDate) params.set("endDate", nextFilters.endDate);

      const response = await fetchWithAuth(`/v1/audit-logs?${params.toString()}`);
      const result = await response.json();
      if (!response.ok || result.success === false) {
        throw new Error(result.message || "Failed to fetch audit logs");
      }

      setAuditLogs(Array.isArray(result.logs) ? result.logs : []);
      setAuditPagination(result.pagination || { page: 1, limit: 20, total: 0, totalPages: 1 });
    } catch (error) {
      toast.error(`Failed to load audit logs: ${error.message}`);
    } finally {
      setAuditLoading(false);
    }
  };

  const applyAuditFilters = async () => {
    await fetchAuditLogs(1, auditFilters);
  };

  const resetAuditFilters = async () => {
    const reset = { eventType: "", entityId: "", startDate: "", endDate: "" };
    setAuditFilters(reset);
    await fetchAuditLogs(1, reset);
  };

  useEffect(() => {
    load();
    fetchAuditLogs(1);
  }, [fetchWithAuth]);

  const metrics = dashboard?.windowMetrics || {};
  const totals = dashboard?.totals || {};
  const recentAudit = useMemo(() => (Array.isArray(dashboard?.recentAudit) ? dashboard.recentAudit : []), [dashboard]);
  const trendData = useMemo(() => (Array.isArray(dashboard?.trends) ? dashboard.trends : []), [dashboard]);

  if (loading) {
    return <div className="p-4 text-sm text-slate-600">Loading mailer operations...</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-slate-900">Mailer Reliability Dashboard</h2>
        <button
          type="button"
          onClick={load}
          className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
        >
          Refresh
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <MetricCard label="Success Rate (24h)" value={`${metrics.successRate || 0}%`} tone="text-emerald-700" />
        <MetricCard label="Retries (24h)" value={String(metrics.retries || 0)} tone="text-amber-700" />
        <MetricCard label="Dead (24h)" value={String(metrics.dead || 0)} tone="text-rose-700" />
        <MetricCard label="Sent (24h)" value={String(metrics.sent || 0)} tone="text-cyan-700" />
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <MetricCard label="Pending" value={String(totals.pending || 0)} />
        <MetricCard label="Processing" value={String(totals.processing || 0)} />
        <MetricCard label="Failed" value={String(totals.failed || 0)} tone="text-amber-700" />
        <MetricCard label="Dead" value={String(totals.dead || 0)} tone="text-rose-700" />
        <MetricCard label="P95 Latency" value={`${metrics?.latency?.p95Ms ?? "-"} ms`} />
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <h3 className="text-sm font-bold text-slate-900">Hourly Trends (24h)</h3>
        <p className="mt-1 text-xs text-slate-500">Success, dead-letter, and retry event volume by hour.</p>
        <div className="mt-4 h-72">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={trendData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
              <Tooltip />
              <Legend />
              <Bar dataKey="sent" name="Sent" fill="#059669" radius={[4, 4, 0, 0]} />
              <Bar dataKey="retry" name="Retry" fill="#d97706" radius={[4, 4, 0, 0]} />
              <Bar dataKey="dead" name="Dead" fill="#dc2626" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <h3 className="text-sm font-bold text-slate-900">Dead Letter Queue</h3>
        {deadJobs.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500">No dead-letter jobs right now.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-slate-500">
                  <th className="py-2 pr-3">Created</th>
                  <th className="py-2 pr-3">To</th>
                  <th className="py-2 pr-3">Subject</th>
                  <th className="py-2 pr-3">Attempts</th>
                  <th className="py-2 pr-3">Error</th>
                  <th className="py-2">Action</th>
                </tr>
              </thead>
              <tbody>
                {deadJobs.map((job) => (
                  <tr key={job._id} className="border-b border-slate-100 align-top">
                    <td className="py-2 pr-3 text-slate-600">{new Date(job.createdAt).toLocaleString()}</td>
                    <td className="py-2 pr-3 text-slate-700">{(job.payload?.to || []).join(", ") || "-"}</td>
                    <td className="py-2 pr-3 text-slate-700">{job.payload?.subject || "-"}</td>
                    <td className="py-2 pr-3 font-semibold text-slate-900">{job.attempt}/{job.maxAttempts}</td>
                    <td className="py-2 pr-3 text-rose-700">{job.lastError || "-"}</td>
                    <td className="py-2">
                      <button
                        type="button"
                        onClick={() => retryJob(job._id)}
                        disabled={retryingId === job._id}
                        className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {retryingId === job._id ? "Retrying..." : "Retry"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <h3 className="text-sm font-bold text-slate-900">Recent Audit Events (24h)</h3>
        {recentAudit.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500">No audit events in this window.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {recentAudit.slice(0, 20).map((event) => (
              <li key={event._id} className="rounded-md border border-slate-100 bg-slate-50 p-2 text-xs">
                <div className="font-semibold text-slate-800">{event.eventType}</div>
                <div className="text-slate-600">
                  {new Date(event.at || event.createdAt).toLocaleString()} | entity: {event.entityId}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-bold text-slate-900">Audit Explorer</h3>
          <div className="text-xs text-slate-500">Filter and inspect all outbound mailer audit events.</div>
        </div>

        <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-4">
          <input
            type="text"
            value={auditFilters.eventType}
            onChange={(e) => setAuditFilters((prev) => ({ ...prev, eventType: e.target.value }))}
            placeholder="eventType (job_sent)"
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
          <input
            type="text"
            value={auditFilters.entityId}
            onChange={(e) => setAuditFilters((prev) => ({ ...prev, entityId: e.target.value }))}
            placeholder="entityId"
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
          <input
            type="datetime-local"
            value={auditFilters.startDate}
            onChange={(e) => setAuditFilters((prev) => ({ ...prev, startDate: e.target.value }))}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
          <input
            type="datetime-local"
            value={auditFilters.endDate}
            onChange={(e) => setAuditFilters((prev) => ({ ...prev, endDate: e.target.value }))}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
        </div>

        <div className="mt-2 flex gap-2">
          <button
            type="button"
            onClick={applyAuditFilters}
            className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-700"
          >
            Apply Filters
          </button>
          <button
            type="button"
            onClick={resetAuditFilters}
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            Reset
          </button>
        </div>

        {auditLoading ? (
          <p className="mt-3 text-sm text-slate-500">Loading audit logs...</p>
        ) : auditLogs.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">No audit logs found for the current filters.</p>
        ) : (
          <div className="mt-3 space-y-2">
            {auditLogs.map((log) => (
              <details key={log._id} className="rounded-md border border-slate-200 bg-slate-50 p-2">
                <summary className="cursor-pointer text-xs font-semibold text-slate-800">
                  {log.eventType} | {new Date(log.at || log.createdAt).toLocaleString()} | entity: {log.entityId}
                </summary>
                <pre className="mt-2 overflow-x-auto rounded bg-slate-900 p-2 text-[11px] text-slate-100">
{JSON.stringify(log, null, 2)}
                </pre>
              </details>
            ))}
          </div>
        )}

        <div className="mt-3 flex items-center justify-between text-xs text-slate-600">
          <div>
            Page {auditPagination.page} of {auditPagination.totalPages} ({auditPagination.total} events)
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => fetchAuditLogs(Math.max(1, auditPagination.page - 1))}
              disabled={auditPagination.page <= 1 || auditLoading}
              className="rounded-md border border-slate-300 bg-white px-2 py-1 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Previous
            </button>
            <button
              type="button"
              onClick={() => fetchAuditLogs(Math.min(auditPagination.totalPages || 1, auditPagination.page + 1))}
              disabled={auditPagination.page >= auditPagination.totalPages || auditLoading}
              className="rounded-md border border-slate-300 bg-white px-2 py-1 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Next
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
