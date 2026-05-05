import React from "react";
import { Home } from "lucide-react";

function classNames(...classes) {
  return classes.filter(Boolean).join(" ");
}

export function DeskShell({ children }) {
  return (
    <div className="min-h-screen w-full bg-[radial-gradient(1300px_520px_at_15%_-10%,rgba(16,185,129,0.14),transparent),radial-gradient(920px_520px_at_95%_0%,rgba(14,165,233,0.12),transparent)] font-['Plus_Jakarta_Sans','Manrope',sans-serif] text-slate-900">
      {children}
    </div>
  );
}

export function DeskPageHero({
  area,
  title,
  description,
  statusLabel,
  stats = [],
}) {
  return (
    <section className="rounded-2xl border border-white/80 bg-white/85 p-4 shadow-[0_24px_70px_-38px_rgba(15,23,42,0.5)] backdrop-blur-sm md:p-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
            <Home className="h-3.5 w-3.5" />
            <span>{area}</span>
            <span>/</span>
            <span className="text-slate-700">{title}</span>
          </div>
          <h1 className="mt-1 text-2xl font-black tracking-tight text-slate-900">{title}</h1>
          <p className="mt-1 text-sm text-slate-600">{description}</p>
        </div>
        {statusLabel ? (
          <div className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
            {statusLabel}
          </div>
        ) : null}
      </div>
      {stats.length ? (
        <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
          {stats.map((stat) => (
            <div
              key={stat.label}
              className="rounded-xl border border-slate-200 bg-slate-50/80 px-3 py-2"
            >
              <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">
                {stat.label}
              </div>
              <div className={classNames("mt-1 text-sm font-bold", stat.tone || "text-slate-800")}>
                {stat.value}
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}

export function DeskContentCard({ children }) {
  return (
    <section className="rounded-2xl border border-white/80 bg-white/85 p-4 shadow-[0_24px_70px_-38px_rgba(15,23,42,0.5)] backdrop-blur-sm md:p-6">
      {children}
    </section>
  );
}

