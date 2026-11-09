import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as ticketsApi from "../api/tickets";
import type { ListTicketsParams } from "../api/tickets";
import type { TicketStatus, TicketPriority } from "../types";

export function useTicketList(params: ListTicketsParams) {
  // The query key includes every param that affects the result - TanStack
  // Query treats a different key as a DIFFERENT cache entry, which is
  // exactly what we want: switching the status filter shouldn't show stale
  // results from the previous filter while the new page loads.
  return useQuery({
    queryKey: ["tickets", params],
    queryFn: () => ticketsApi.listTicketsRequest(params),
    placeholderData: (prev) => prev, // keep showing the old page while the new one loads, instead of a flash of empty state
  });
}

export function useTicket(id: string | undefined) {
  return useQuery({
    queryKey: ["ticket", id],
    queryFn: () => ticketsApi.getTicketRequest(id!),
    enabled: !!id,
  });
}

export function useCreateTicket() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ticketsApi.createTicketRequest,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tickets"] }),
  });
}

export function useUpdateTicketStatus(ticketId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (status: TicketStatus) => ticketsApi.updateTicketStatusRequest(ticketId, status),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ticket", ticketId] });
      qc.invalidateQueries({ queryKey: ["tickets"] });
    },
  });
}

export function useUpdateTicketPriority(ticketId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (priority: TicketPriority) => ticketsApi.updateTicketPriorityRequest(ticketId, priority),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ticket", ticketId] });
      qc.invalidateQueries({ queryKey: ["tickets"] });
    },
  });
}

export function useUpdateTicketTags(ticketId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (tags: string[]) => ticketsApi.updateTicketTagsRequest(ticketId, tags),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ticket", ticketId] }),
  });
}

export function useAssignToSelf(ticketId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => ticketsApi.assignTicketToSelfRequest(ticketId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ticket", ticketId] });
      qc.invalidateQueries({ queryKey: ["tickets"] });
    },
  });
}

export function useAnalyzeTicketWithAi(ticketId: string) {
  // A mutation, not a query: this is a deliberate "generate me a suggestion
  // right now" action (and it costs an LLM call when a real key is
  // configured), not passive data to fetch/cache/refetch-on-focus like the
  // rest of this file's useQuery hooks.
  return useMutation({
    mutationFn: () => ticketsApi.analyzeTicketWithAiRequest(ticketId),
  });
}

export function useUploadAttachment(ticketId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (file: File) => ticketsApi.uploadAttachmentRequest(ticketId, file),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ticket", ticketId] }),
  });
}

export function useComments(ticketId: string | undefined) {
  return useQuery({
    queryKey: ["comments", ticketId],
    queryFn: () => ticketsApi.listCommentsRequest(ticketId!),
    enabled: !!ticketId,
  });
}

export function useAddComment(ticketId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ text, isInternal }: { text: string; isInternal: boolean }) =>
      ticketsApi.addCommentRequest(ticketId, text, isInternal),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["comments", ticketId] });
      qc.invalidateQueries({ queryKey: ["ticket", ticketId] }); // a customer reply can auto-transition status
    },
  });
}
