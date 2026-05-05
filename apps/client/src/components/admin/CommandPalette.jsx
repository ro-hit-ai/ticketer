import React, { useEffect, useMemo, useState } from "react";
import { Dialog, Transition } from "@headlessui/react";
import { Fragment } from "react";
import { Search, Ticket, Users, MessageSquare, PlusCircle } from "lucide-react";

const ICONS = {
  ticket: Ticket,
  users: Users,
  messages: MessageSquare,
  create: PlusCircle,
};

function CommandPalette({ open, onClose, commands, onSelect }) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    return commands.filter((command) =>
      `${command.title} ${command.keywords || ""}`.toLowerCase().includes(q)
    );
  }, [commands, query]);

  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  return (
    <Transition.Root show={open} as={Fragment}>
      <Dialog as="div" className="relative z-[100]" onClose={onClose}>
        <Transition.Child
          as={Fragment}
          enter="ease-out duration-150"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="ease-in duration-100"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-slate-950/40 backdrop-blur-[2px]" />
        </Transition.Child>

        <div className="fixed inset-0 flex items-start justify-center p-4 pt-[10vh]">
          <Transition.Child
            as={Fragment}
            enter="ease-out duration-150"
            enterFrom="opacity-0 scale-95"
            enterTo="opacity-100 scale-100"
            leave="ease-in duration-100"
            leaveFrom="opacity-100 scale-100"
            leaveTo="opacity-0 scale-95"
          >
            <Dialog.Panel className="w-full max-w-2xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
              <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-3">
                <Search className="h-4 w-4 text-slate-400" />
                <input
                  autoFocus
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search tickets, users, routes, or actions..."
                  className="w-full border-0 bg-transparent text-sm text-slate-900 outline-none"
                />
                <span className="rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-semibold text-slate-500">
                  ESC
                </span>
              </div>

              <div className="max-h-[55vh] overflow-y-auto p-2">
                {filtered.length === 0 ? (
                  <div className="rounded-lg px-3 py-4 text-sm text-slate-500">No results found.</div>
                ) : (
                  filtered.map((command) => {
                    const Icon = ICONS[command.icon] || Search;
                    return (
                      <button
                        key={command.id}
                        type="button"
                        onClick={() => {
                          onSelect(command);
                          onClose();
                        }}
                        className="group flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-slate-100"
                      >
                        <span className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-slate-100 text-slate-600 group-hover:bg-white">
                          <Icon className="h-4 w-4" />
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-semibold text-slate-800">{command.title}</span>
                          <span className="block truncate text-xs text-slate-500">{command.description}</span>
                        </span>
                        {command.shortcut ? (
                          <span className="ml-auto rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-semibold text-slate-500">
                            {command.shortcut}
                          </span>
                        ) : null}
                      </button>
                    );
                  })
                )}
              </div>
            </Dialog.Panel>
          </Transition.Child>
        </div>
      </Dialog>
    </Transition.Root>
  );
}

export default CommandPalette;

