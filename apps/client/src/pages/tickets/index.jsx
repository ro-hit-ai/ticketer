// src/pages/tickets/index.jsx
import React, { useState, useEffect, useCallback, useMemo } from "react";
import { useNavigate, useSearchParams, useLocation } from "react-router-dom";
import { Mail, Plus, UserCheck, CheckCircle, Clock, Settings, Filter, Search, X } from "lucide-react";
import { toast } from "react-toastify";
import { useUser } from "../../store/session";
import { useSocket } from "../../store/socket";
import { Button } from "../../shadcn/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "../../shadcn/ui/popover";
import { Switch } from "../../shadcn/ui/switch";
import { Label } from "../../shadcn/ui/label";
import { Separator } from "../../shadcn/ui/separator";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "../../shadcn/ui/command";
import { CheckIcon } from "lucide-react";
import { cn } from "../../shadcn/lib/utils";

// Kanban drag and drop - Only import if available
let draggable, dropTargetForElements;
try {
  const dnd = require('@atlaskit/pragmatic-drag-and-drop/element/adapter');
  draggable = dnd.draggable;
  dropTargetForElements = dnd.dropTargetForElements;
} catch (e) {
  console.log("Drag and drop library not available");
}

const Tickets = () => {
  const { fetchWithAuth, isAgent, user, loading: userLoading } = useUser();
  const socket = useSocket();
  const [tickets, setTickets] = useState([]);
  const [agents, setAgents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [assigning, setAssigning] = useState(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();

  // New state for advanced features
  const [viewMode, setViewMode] = useState('list'); // 'list' or 'kanban'
  const [uiSettings, setUISettings] = useState({
    showAvatars: true,
    showDates: true,
    showPriority: true,
    showType: true,
    showTicketNumbers: true,
  });
  const [selectedPriorities, setSelectedPriorities] = useState([]);
  const [selectedAssignees, setSelectedAssignees] = useState([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [activeFilter, setActiveFilter] = useState(null);
  const [filterSearch, setFilterSearch] = useState("");
  const [kanbanGrouping, setKanbanGrouping] = useState('status');
  const [sortBy, setSortBy] = useState('newest');
  const [denseMode, setDenseMode] = useState(localStorage.getItem("layoutDensity") !== "comfortable");

  // Detect routes
  const isAgentRoute = location.pathname.startsWith("/agents");
  const isAgentView = isAgent || isAgentRoute;
  const isDetailPage = /\/tickets\/[0-9a-fA-F]{24}$/i.test(location.pathname);

  const status = searchParams.get("status") || "open";
  const canAssign = !isAgentView;
  const canCreate = !isAgentView;
  const basePath = isAgentView ? "/agents" : "/portal";

  // ENDPOINTS
  const getEndpoint = () => {
    if (isAgentView) {
      return status === "closed"
        ? "/v1/ticket/tickets/user/completed"
        : "/v1/ticket/tickets/user/open";
    }
    return status === "closed"
      ? "/v1/ticket/tickets/completed"
      : "/v1/ticket/tickets/open";
  };

  const fetchTickets = useCallback(async () => {
    if (isDetailPage) return;
    if (userLoading || !user?._id) return;

    const endpoint = getEndpoint();
    try {
      setLoading(true);
      const res = await fetchWithAuth(endpoint);
      if (!res.ok) throw new Error("Failed");
      const { tickets } = await res.json();
      setTickets(tickets || []);
    } catch (err) {
      toast.error("Failed to load tickets");
    } finally {
      setLoading(false);
    }
  }, [fetchWithAuth, user?._id, userLoading, status, isDetailPage, isAgentView]);

  const fetchAgents = async () => {
    try {
      const res = await fetchWithAuth(`/v1/user/all`);
      const data = await res.json();
      if (data.success) setAgents(data.users);
    } catch (err) {
      console.error("Failed to load agents");
    }
  };

  const assignTicket = async (ticketId, agentId) => {
    if (!canAssign) return;
    setAssigning(ticketId);
    try {
      const res = await fetchWithAuth(`/v1/ticket/assign/${ticketId}`, {
        method: "PATCH",
        body: JSON.stringify({ assignedTo: agentId || null }),
      });
      const { ticket } = await res.json();
      setTickets((prev) =>
        prev.map((t) =>
          t._id === ticketId ? { ...t, assignedTo: ticket.assignedTo } : t
        )
      );
      const name = agents.find((a) => a._id === agentId)?.name || "Agent";
      toast.success(`Assigned to ${name}`);
    } catch {
      toast.error("Assignment failed");
    } finally {
      setAssigning(null);
    }
  };

  // Filter and sort tickets
  const filteredTickets = useMemo(() => {
    let filtered = tickets.filter((ticket) => {
      // Status filter from URL
      if (status === "open" && ticket.isComplete) return false;
      if (status === "closed" && !ticket.isComplete) return false;
      
      // Priority filters
      if (selectedPriorities.length > 0 && !selectedPriorities.includes(ticket.priority)) {
        return false;
      }
      
      // Assignee filters
      if (selectedAssignees.length > 0) {
        const assigneeName = ticket.assignedTo?.name || "Unassigned";
        if (!selectedAssignees.includes(assigneeName)) return false;
      }
      
      // Search term
      if (searchTerm) {
        const searchLower = searchTerm.toLowerCase();
        if (!ticket.title?.toLowerCase().includes(searchLower) && 
            !ticket.number?.toString().includes(searchLower) &&
            !ticket.client?.name?.toLowerCase().includes(searchLower)) {
          return false;
        }
      }
      
      return true;
    });

    // Sort tickets
    filtered.sort((a, b) => {
      switch (sortBy) {
        case 'newest':
          return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        case 'oldest':
          return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
        case 'priority':
          const priorityOrder = { high: 3, medium: 2, low: 1 };
          return (priorityOrder[b.priority] || 0) - (priorityOrder[a.priority] || 0);
        case 'title':
          return a.title?.localeCompare(b.title || '');
        default:
          return 0;
      }
    });

    return filtered;
  }, [tickets, status, selectedPriorities, selectedAssignees, searchTerm, sortBy]);

  // Get kanban columns
  const getKanbanColumns = () => {
    if (kanbanGrouping === 'status') {
      return [
        {
          id: 'open',
          title: 'Open',
          color: 'bg-yellow-500',
          tickets: filteredTickets.filter(t => !t.isComplete)
        },
        {
          id: 'closed',
          title: 'Closed',
          color: 'bg-green-500',
          tickets: filteredTickets.filter(t => t.isComplete)
        }
      ];
    }
    
    if (kanbanGrouping === 'priority') {
      const priorities = ['high', 'medium', 'low'];
      return priorities.map(priority => ({
        id: priority,
        title: priority.charAt(0).toUpperCase() + priority.slice(1),
        color: priority === 'high' ? 'bg-red-500' : 
               priority === 'medium' ? 'bg-blue-500' : 'bg-green-500',
        tickets: filteredTickets.filter(t => t.priority === priority)
      }));
    }
    
    // Group by assignee
    const assignees = {};
    filteredTickets.forEach(ticket => {
      const assigneeName = ticket.assignedTo?.name || 'Unassigned';
      if (!assignees[assigneeName]) assignees[assigneeName] = [];
      assignees[assigneeName].push(ticket);
    });
    
    return Object.entries(assignees).map(([name, ticketList]) => ({
      id: name.toLowerCase().replace(/\s+/g, '-'),
      title: name,
      color: 'bg-indigo-500',
      tickets: ticketList
    }));
  };

  // WebSocket updates
  useEffect(() => {
    if (!socket) return;
    socket.on("ticket:update", (updatedTicket) => {
      setTickets((prev) =>
        prev.map((t) => (t._id === updatedTicket._id ? updatedTicket : t))
      );
    });
    return () => socket.off("ticket:update");
  }, [socket]);

  // Initial fetch
  useEffect(() => {
    if (!isDetailPage) {
      fetchTickets();
      fetchAgents();
    }
  }, [fetchTickets, isDetailPage]);

  // Load UI settings from localStorage
  useEffect(() => {
    const savedSettings = localStorage.getItem('ticketUISettings');
    if (savedSettings) {
      setUISettings(JSON.parse(savedSettings));
    }
  }, []);

  // Save UI settings to localStorage
  useEffect(() => {
    localStorage.setItem('ticketUISettings', JSON.stringify(uiSettings));
  }, [uiSettings]);
  useEffect(() => {
    const onStorage = () => setDenseMode(localStorage.getItem("layoutDensity") !== "comfortable");
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  // Loading state
  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" />
        <span className="ml-3 text-sm text-slate-600">Loading tickets…</span>
      </div>
    );
  }

  // Helper components
  const FilterBadge = ({ text, onRemove }) => (
    <div className="flex items-center gap-1 bg-indigo-50 rounded-md px-2 py-1 text-xs border border-indigo-100">
      <span>{text}</span>
      <button
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onRemove();
        }}
        className="hover:bg-indigo-100 rounded-full p-0.5"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );

  const TicketKanbanCard = React.memo(({ ticket }) => {
    const cardRef = React.useRef(null);
    
    React.useEffect(() => {
      if (!draggable || !cardRef.current) return;
      
      const cleanup = draggable({
        element: cardRef.current,
        dragHandle: cardRef.current,
        getInitialData: () => ({ ticketId: ticket._id }),
      });
      
      return cleanup;
    }, [ticket._id]);
    
    return (
      <div
        ref={cardRef}
        className="bg-white rounded-lg shadow-sm border p-3 cursor-move hover:shadow-md transition-shadow"
        onClick={() => navigate(`${basePath}/tickets/${ticket._id}`)}
      >
        <div className="flex flex-col gap-2">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-baseline gap-2 min-w-0 flex-1">
              {uiSettings.showTicketNumbers && (
                <span className="text-xs text-gray-500">#{ticket.number}</span>
              )}
              <span className="text-sm font-medium truncate">
                {ticket.title}
              </span>
            </div>
            {uiSettings.showAvatars && ticket.assignedTo && (
              <div className="h-5 w-5 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0">
                <span className="text-xs font-medium text-blue-800">
                  {ticket.assignedTo.name[0]}
                </span>
              </div>
            )}
          </div>
          
          <div className="flex flex-wrap gap-2 mt-1">
            {uiSettings.showDates && (
              <span className="text-xs text-gray-500">
                {new Date(ticket.createdAt).toLocaleDateString()}
              </span>
            )}
            
            {uiSettings.showPriority && (
              <span className={`inline-flex items-center rounded-md px-2 py-1 text-xs font-medium capitalize ${
                ticket.priority === 'high' ? 'bg-red-100 text-red-800' : 
                ticket.priority === 'medium' ? 'bg-blue-100 text-blue-800' : 
                'bg-green-100 text-green-800'
              }`}>
                {ticket.priority}
              </span>
            )}
          </div>
        </div>
      </div>
    );
  });

  const KanbanColumn = React.memo(({ column, onDrop }) => {
    const columnRef = React.useRef(null);
    const [isDraggedOver, setIsDraggedOver] = React.useState(false);
    
    React.useEffect(() => {
      if (!dropTargetForElements || !columnRef.current) return;
      
      const cleanup = dropTargetForElements({
        element: columnRef.current,
        getData: () => ({ columnId: column.id }),
        onDragEnter: () => setIsDraggedOver(true),
        onDragLeave: () => setIsDraggedOver(false),
        onDrop: ({ source }) => {
          setIsDraggedOver(false);
          if (source.data.ticketId) {
            onDrop(source.data.ticketId, column.id);
          }
        },
      });
      
      return cleanup;
    }, [column.id, onDrop]);
    
    return (
      <div
        ref={columnRef}
        className={`w-80 flex-shrink-0 bg-gray-50 rounded-lg flex flex-col max-h-[calc(100vh-12rem)] 
          ${isDraggedOver ? 'ring-2 ring-indigo-500 ring-inset' : ''}`}
      >
        <div className="p-3 border-b">
          <div className="flex items-center gap-2">
            <div className={`h-2 w-2 rounded-full ${column.color}`} />
            <span className="font-medium text-sm">{column.title}</span>
            <span className="text-gray-500 text-xs">({column.tickets.length})</span>
          </div>
        </div>
        
        <div className="p-2 pb-4 space-y-2 overflow-y-auto flex-grow">
          {column.tickets.map((ticket) => (
            <TicketKanbanCard key={ticket._id} ticket={ticket} />
          ))}
        </div>
      </div>
    );
  });

  // Handle kanban ticket movement
  const handleKanbanMove = async (ticketId, columnId) => {
    const isClosing = columnId === 'closed';
    const isOpening = columnId === 'open';
    
    if (!isClosing && !isOpening) return; // Only support open/closed for now
    
    try {
      const res = await fetchWithAuth("/v1/ticket/status/update", {
        method: "PUT",
        body: JSON.stringify({
          id: ticketId,
          status: isClosing,
        }),
      });
      
      if (res.ok) {
        fetchTickets();
        toast.success(`Ticket ${isClosing ? 'closed' : 'reopened'}`);
      }
    } catch (err) {
      toast.error("Failed to update ticket");
    }
  };

  // Filter component
  const TicketFilters = () => (
    <div className="flex flex-row items-center gap-2">
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="sm" className="h-6 bg-transparent">
            <Filter className="mr-2 h-4 w-4" />
            <span className="hidden sm:block">Filters</span>
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[300px] p-0" align="start">
          {!activeFilter ? (
            <Command>
              <CommandInput 
                placeholder="Search filters..." 
                value={filterSearch}
                onValueChange={setFilterSearch}
              />
              <CommandList>
                <CommandEmpty>No results found.</CommandEmpty>
                <CommandGroup>
                  <CommandItem onSelect={() => setActiveFilter("priority")}>
                    Priority
                  </CommandItem>
                  <CommandItem onSelect={() => setActiveFilter("assignee")}>
                    Assignee
                  </CommandItem>
                </CommandGroup>
              </CommandList>
            </Command>
          ) : (
            <Command>
              <CommandInput 
                placeholder={`Search ${activeFilter}...`}
                value={filterSearch}
                onValueChange={setFilterSearch}
              />
              <CommandList>
                <CommandEmpty>No results found.</CommandEmpty>
                <CommandGroup>
                  {activeFilter === "priority" &&
                    ['high', 'medium', 'low'].map((priority) => (
                      <CommandItem
                        key={priority}
                        onSelect={() => {
                          setSelectedPriorities(prev =>
                            prev.includes(priority)
                              ? prev.filter(p => p !== priority)
                              : [...prev, priority]
                          );
                          setActiveFilter(null);
                          setFilterSearch("");
                        }}
                      >
                        <div
                          className={cn(
                            "mr-2 flex h-4 w-4 items-center justify-center rounded-sm border border-primary",
                            selectedPriorities.includes(priority)
                              ? "bg-primary text-primary-foreground"
                              : "opacity-50 [&_svg]:invisible"
                          )}
                        >
                          <CheckIcon className={cn("h-4 w-4")} />
                        </div>
                        <span className="capitalize">{priority}</span>
                      </CommandItem>
                    ))}

                  {activeFilter === "assignee" &&
                    ['Unassigned', ...agents.map(a => a.name)].map((assignee) => (
                      <CommandItem
                        key={assignee}
                        onSelect={() => {
                          setSelectedAssignees(prev =>
                            prev.includes(assignee)
                              ? prev.filter(a => a !== assignee)
                              : [...prev, assignee]
                          );
                          setActiveFilter(null);
                          setFilterSearch("");
                        }}
                      >
                        <div
                          className={cn(
                            "mr-2 flex h-4 w-4 items-center justify-center rounded-sm border border-primary",
                            selectedAssignees.includes(assignee)
                              ? "bg-primary text-primary-foreground"
                              : "opacity-50 [&_svg]:invisible"
                          )}
                        >
                          <CheckIcon className={cn("h-4 w-4")} />
                        </div>
                        {assignee}
                      </CommandItem>
                    ))}
                </CommandGroup>
              </CommandList>
            </Command>
          )}
        </PopoverContent>
      </Popover>

      <div className="flex flex-wrap gap-2">
        {selectedPriorities.map((priority) => (
          <FilterBadge
            key={`priority-${priority}`}
            text={`Priority: ${priority}`}
            onRemove={() => setSelectedPriorities(prev => prev.filter(p => p !== priority))}
          />
        ))}

        {selectedAssignees.map((assignee) => (
          <FilterBadge
            key={`assignee-${assignee}`}
            text={`Assignee: ${assignee}`}
            onRemove={() => setSelectedAssignees(prev => prev.filter(a => a !== assignee))}
          />
        ))}

        {(selectedPriorities.length > 0 || selectedAssignees.length > 0) && (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-xs"
            onClick={() => {
              setSelectedPriorities([]);
              setSelectedAssignees([]);
            }}
          >
            Clear all
          </Button>
        )}
      </div>
    </div>
  );

  // View settings component
  const ViewSettings = () => (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className="h-8">
          <Settings className="h-4 w-4 mr-2" />
          <span className="hidden sm:inline">Settings</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[240px] p-3" align="end">
        <div className="space-y-4">
          <div>
            <h4 className="text-sm font-medium mb-2">View Mode</h4>
            <div className="grid grid-cols-2 gap-2">
              <Button
                variant={viewMode === 'list' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setViewMode('list')}
                className="w-full"
              >
                List
              </Button>
              <Button
                variant={viewMode === 'kanban' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setViewMode('kanban')}
                className="w-full"
              >
                Kanban
              </Button>
            </div>
          </div>
          
          {viewMode === 'list' && (
            <div>
              <h4 className="text-sm font-medium mb-2">Sort By</h4>
              <div className="grid grid-cols-1 gap-2">
                {['newest', 'oldest', 'priority', 'title'].map((option) => (
                  <Button
                    key={option}
                    variant={sortBy === option ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setSortBy(option)}
                    className="w-full justify-start capitalize"
                  >
                    {option.replace(/([A-Z])/g, ' $1')}
                  </Button>
                ))}
              </div>
            </div>
          )}
          
          {viewMode === 'kanban' && (
            <div>
              <h4 className="text-sm font-medium mb-2">Group By</h4>
              <div className="grid grid-cols-1 gap-2">
                {['status', 'priority', 'assignee'].map((grouping) => (
                  <Button
                    key={grouping}
                    variant={kanbanGrouping === grouping ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setKanbanGrouping(grouping)}
                    className="w-full justify-start capitalize"
                  >
                    {grouping.replace(/([A-Z])/g, ' $1')}
                  </Button>
                ))}
              </div>
            </div>
          )}
          
          <Separator />
          
          <div>
            <h4 className="text-sm font-medium mb-3">Display Options</h4>
            <div className="space-y-3">
              {Object.entries(uiSettings).map(([key, value]) => (
                <div key={key} className="flex items-center justify-between">
                  <Label htmlFor={key} className="text-sm capitalize">
                    {key.replace(/([A-Z])/g, ' $1')}
                  </Label>
                  <Switch
                    id={key}
                    checked={value}
                    onCheckedChange={(checked) => 
                      setUISettings(prev => ({ ...prev, [key]: checked }))
                    }
                  />
                </div>
              ))}
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );

  // List view row component
  const TicketListRow = ({ ticket }) => (
    <tr
      key={ticket._id}
      onClick={() => navigate(`${basePath}/tickets/${ticket._id}`)}
      className={denseMode ? "hover:bg-slate-50/80 cursor-pointer" : "hover:bg-slate-50/80 cursor-pointer"}
    >
      <td className={denseMode ? "px-3 py-2 text-[11px] font-mono text-slate-600" : "px-4 py-3 text-xs font-mono text-slate-600"}>
        {uiSettings.showTicketNumbers && `#${ticket.number}`}
      </td>

      <td className={denseMode ? "px-3 py-2 text-xs font-medium text-slate-900" : "px-4 py-3 text-sm font-medium text-slate-900"}>
        <div className="flex flex-col">
          <span className="line-clamp-1">{ticket.title}</span>
          <span className="mt-0.5 text-[11px] text-slate-400">
            {ticket.client?.name || "Unknown Client"}
          </span>
        </div>
      </td>

      <td className={denseMode ? "px-3 py-2" : "px-4 py-3"}>
        {uiSettings.showPriority && (
          <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold bg-indigo-50 text-indigo-700 border border-indigo-100">
            {ticket.priority}
          </span>
        )}
      </td>

      <td className={denseMode ? "px-3 py-2 text-xs" : "px-4 py-3 text-sm"}>
        <span
          className={`inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
            ticket.isComplete
              ? "bg-emerald-50 text-emerald-700 border border-emerald-100"
              : "bg-amber-50 text-amber-700 border border-amber-100"
          }`}
        >
          {ticket.isComplete ? "Closed" : "Open"}
        </span>
      </td>

      <td className={denseMode ? "px-3 py-2 text-xs" : "px-4 py-3 text-sm"}>
        <div className="flex items-center gap-2">
          {uiSettings.showAvatars && ticket.assignedTo && (
            <div className="h-6 w-6 rounded-full bg-blue-100 flex items-center justify-center">
              <span className="text-xs font-medium text-blue-800">
                {ticket.assignedTo.name[0]}
              </span>
            </div>
          )}
          <span className="text-xs text-indigo-600">
            {ticket.assignedTo?.name || "Unassigned"}
          </span>
        </div>
      </td>

      <td className={denseMode ? "px-3 py-2 text-right text-xs" : "px-4 py-3 text-right text-sm"}>
        {canAssign ? (
          <select
            disabled={assigning === ticket._id || ticket.isComplete}
            value={ticket.assignedTo?._id || ""}
            onChange={(e) => {
              e.stopPropagation();
              assignTicket(ticket._id, e.target.value || null);
            }}
            className="text-xs rounded-md border px-2 py-1 bg-white"
            onClick={(e) => e.stopPropagation()}
          >
            <option value="">Unassigned</option>
            {agents.map((agent) => (
              <option key={agent._id} value={agent._id}>
                {agent.name}
              </option>
            ))}
          </select>
        ) : (
          <span className="text-slate-400">→</span>
        )}
      </td>
    </tr>
  );

  return (
    <div className={denseMode ? "space-y-3 p-3" : "space-y-5 p-4"}>
      {/* Header */}
      <div className={denseMode ? "desk-v2-actionbar flex items-center justify-between rounded-xl border bg-white px-3 py-2 shadow-sm" : "flex items-center justify-between rounded-xl border bg-white px-4 py-3 shadow-sm"}>
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-lg bg-indigo-50 flex items-center justify-center">
            <Mail className="h-5 w-5 text-indigo-600" />
          </div>
          <div>
            <h1 className={denseMode ? "text-lg font-semibold text-slate-900" : "text-xl font-semibold text-slate-900"}>
              Tickets Workspace
            </h1>
            <p className="text-xs text-slate-500">
              View, {canAssign ? "assign and " : ""}track all customer tickets.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <ViewSettings />
          
          <button
            onClick={fetchTickets}
            className="inline-flex items-center rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            ↻ Refresh
          </button>

          {canCreate && (
            <button
              onClick={() => navigate("/portal/tickets/new")}
              className="inline-flex items-center rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white shadow-sm hover:bg-indigo-700"
            >
              <Plus className="mr-1 h-4 w-4" />
              New Ticket
            </button>
          )}
        </div>
      </div>

      {/* Search and Filters */}
      <div className={denseMode ? "desk-v2-actionbar rounded-xl border bg-white px-3 py-2 shadow-sm" : "rounded-xl border bg-white px-4 py-3 shadow-sm"}>
        <div className="flex flex-col md:flex-row gap-3">
          <div className="flex-1">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
              <input
                type="text"
                placeholder="Search tickets by title, number, or client..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border rounded-md text-sm"
              />
              {searchTerm && (
                <button
                  onClick={() => setSearchTerm("")}
                  className="absolute right-3 top-1/2 transform -translate-y-1/2"
                >
                  <X className="h-4 w-4 text-gray-400" />
                </button>
              )}
            </div>
          </div>
          
          <div className="flex items-center gap-2">
            <TicketFilters />
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className={denseMode ? "desk-v2-actionbar rounded-xl border bg-white px-3 pt-2 pb-1 shadow-sm" : "rounded-xl border bg-white px-4 pt-3 pb-1 shadow-sm"}>
        <nav className="-mb-px flex space-x-6">
          <button
            onClick={() => setSearchParams({ status: "open" })}
            className={`inline-flex items-center border-b-2 px-1 pb-2 text-sm font-medium ${
              status === "open"
                ? "border-indigo-500 text-indigo-600"
                : "border-transparent text-slate-500"
            }`}
          >
            <Clock className="mr-1.5 h-4 w-4" />
            Open
            <span className="ml-2 rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-semibold text-indigo-700">
              {tickets.filter(t => !t.isComplete).length}
            </span>
          </button>

          <button
            onClick={() => setSearchParams({ status: "closed" })}
            className={`inline-flex items-center border-b-2 px-1 pb-2 text-sm font-medium ${
              status === "closed"
                ? "border-emerald-500 text-emerald-600"
                : "border-transparent text-slate-500"
            }`}
          >
            <CheckCircle className="mr-1.5 h-4 w-4" />
            Closed
            <span className="ml-2 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700">
              {tickets.filter(t => t.isComplete).length}
            </span>
          </button>
        </nav>
      </div>

      {/* Main Content */}
      {viewMode === 'list' ? (
        /* List View */
        <div className="overflow-hidden rounded-xl border bg-white shadow-sm">
          <table className="min-w-full divide-y divide-slate-200">
            <thead className="bg-slate-50/80">
              <tr>
                {uiSettings.showTicketNumbers && (
                  <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase">
                    Ticket #
                  </th>
                )}
                <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase">
                  Subject
                </th>
                {uiSettings.showPriority && (
                  <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase">
                    Priority
                  </th>
                )}
                <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase">
                  Status
                </th>
                <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase">
                  Assigned To
                </th>
                <th className="px-4 py-3 text-right text-[11px] font-semibold uppercase">
                  Actions
                </th>
              </tr>
            </thead>

            <tbody className="divide-y divide-slate-100 bg-white">
              {filteredTickets.length === 0 ? (
                <tr>
                  <td
                    colSpan="6"
                    className="py-10 text-center text-sm text-slate-500"
                  >
                    No {status} tickets found.
                    {(searchTerm || selectedPriorities.length > 0 || selectedAssignees.length > 0) && 
                      " Try clearing some filters."}
                  </td>
                </tr>
              ) : (
                filteredTickets.map((ticket) => (
                  <TicketListRow key={ticket._id} ticket={ticket} />
                ))
              )}
            </tbody>
          </table>
        </div>
      ) : (
        /* Kanban View */
        <div className="rounded-xl border bg-white p-4 shadow-sm">
          <div className="flex-1 min-w-0 overflow-x-auto">
            <div className="flex gap-4 p-2 min-w-fit">
              {getKanbanColumns().map((column) => (
                <KanbanColumn
                  key={column.id}
                  column={column}
                  onDrop={handleKanbanMove}
                />
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Tickets;
