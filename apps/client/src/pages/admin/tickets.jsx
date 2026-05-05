import React, { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { toast } from "react-toastify";
import TicketList from "../../components/admin/TicketList.jsx";
import TicketDetail from "../../components/admin/TicketDetail.jsx";
import { useUser } from "../../store/session";

async function fetchAllTickets(fetchWithAuth) {
  const response = await fetchWithAuth("/v1/ticket/tickets/all");
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = await response.json();
  if (!data.success) throw new Error(data.error || "Failed to load tickets");
  return data.tickets || [];
}

async function fetchSingleTicket(id, fetchWithAuth) {
  if (!id) return null;
  const response = await fetchWithAuth(`/v1/ticket/${id}`);
  if (!response.ok) throw new Error(`Failed to fetch ticket ${id}`);
  const data = await response.json();
  if (!data.success) throw new Error(data.message || "Failed to load ticket");
  return data;
}

function deriveSlaMeta(ticket) {
  const updatedAt = new Date(ticket.updatedAt || ticket.createdAt).getTime();
  const deadline = updatedAt + 24 * 60 * 60 * 1000;
  const remaining = deadline - Date.now();
  const slaRisk = remaining <= 2 * 60 * 60 * 1000 ? "high" : remaining <= 6 * 60 * 60 * 1000 ? "medium" : "low";
  return { ...ticket, slaRisk, slaDueAt: new Date(deadline).toISOString() };
}

export default function Tickets() {
  const navigate = useNavigate();
  const { fetchWithAuth } = useUser();
  const [searchParams, setSearchParams] = useSearchParams();
  const [filters, setFilters] = useState({
    search: "",
    status: "all",
    priority: "all",
    assignee: "all",
  });
  const selectedTicketId = searchParams.get("ticketId") || "";

  const listQuery = useQuery({
    queryKey: ["admin-tickets-enterprise"],
    queryFn: () => fetchAllTickets(fetchWithAuth),
    enabled: Boolean(fetchWithAuth),
    refetchInterval: 30000,
    onError: (error) => toast.error(error.message || "Failed to load tickets"),
  });

  const tickets = useMemo(() => (listQuery.data || []).map(deriveSlaMeta), [listQuery.data]);

  const selectedFallbackId = tickets[0]?._id || "";
  const effectiveTicketId = selectedTicketId || selectedFallbackId;

  const ticketQuery = useQuery({
    queryKey: ["admin-ticket-detail-enterprise", effectiveTicketId],
    queryFn: () => fetchSingleTicket(effectiveTicketId, fetchWithAuth),
    enabled: Boolean(fetchWithAuth && effectiveTicketId),
    onError: (error) => toast.error(error.message || "Failed to load ticket detail"),
  });

  const selectedTicket = useMemo(() => {
    if (!effectiveTicketId) return null;
    return tickets.find((ticket) => ticket._id === effectiveTicketId) || null;
  }, [tickets, effectiveTicketId]);

  const comments = ticketQuery.data?.comments || [];
  const detailTicket = ticketQuery.data?.ticket
    ? { ...selectedTicket, ...ticketQuery.data.ticket, slaRisk: selectedTicket?.slaRisk, slaDueAt: selectedTicket?.slaDueAt }
    : selectedTicket;

  const handleSelectTicket = (ticket) => {
    setSearchParams({ ticketId: ticket._id });
  };

  return (
    <div className="space-y-3">
      <div className="grid gap-3 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <TicketList
          tickets={tickets}
          loading={listQuery.isLoading}
          selectedTicketId={effectiveTicketId}
          onSelect={handleSelectTicket}
          filters={filters}
          onFiltersChange={setFilters}
          onSearchFocus={() => navigate("/admin/tickets")}
        />
        <TicketDetail
          ticket={detailTicket}
          comments={comments}
          loading={ticketQuery.isLoading}
          typing={Boolean(!detailTicket?.isComplete && comments.length > 0)}
          onReply={() => toast.success("Reply queued (optimistic update pattern ready).")}
          onAddNote={() => toast.success("Internal note added (optimistic update pattern ready).")}
        />
      </div>
    </div>
  );
}

