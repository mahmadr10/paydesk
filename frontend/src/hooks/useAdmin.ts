import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as adminApi from "../api/admin";
import { listActiveCategoriesRequest } from "../api/categories";
import type { TicketPriority, UserRole } from "../types";

// Any logged-in user can fetch the active category list (e.g. to fill the
// Create Ticket form) - distinct from the admin-only management hooks below.
export function useActiveCategories() {
  return useQuery({ queryKey: ["categories", "active"], queryFn: listActiveCategoriesRequest });
}

export function useUsers(params: { role?: UserRole; page?: number; limit?: number }) {
  return useQuery({ queryKey: ["admin", "users", params], queryFn: () => adminApi.listUsersRequest(params) });
}

export function useUpdateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, updates }: { id: string; updates: { role?: UserRole; isActive?: boolean } }) =>
      adminApi.updateUserRequest(id, updates),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "users"] }),
  });
}

export function useCategories() {
  return useQuery({ queryKey: ["admin", "categories"], queryFn: adminApi.listCategoriesRequest });
}

export function useCreateCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ name, description }: { name: string; description?: string }) =>
      adminApi.createCategoryRequest(name, description),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "categories"] }),
  });
}

export function useSetCategoryActive() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) => adminApi.setCategoryActiveRequest(id, isActive),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "categories"] }),
  });
}

export function useSlaPolicies() {
  return useQuery({ queryKey: ["admin", "sla-policies"], queryFn: adminApi.listSlaPoliciesRequest });
}

export function useUpsertSlaPolicy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      priority,
      responseMinutes,
      resolutionMinutes,
    }: {
      priority: TicketPriority;
      responseMinutes: number;
      resolutionMinutes: number;
    }) => adminApi.upsertSlaPolicyRequest(priority, responseMinutes, resolutionMinutes),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "sla-policies"] }),
  });
}
