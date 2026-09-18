import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "./custom-fetch";
import type {
  AuditEntry,
  CreateManualBooking201,
  ManualBookingInput,
  OwnerBookingUpdate,
  OwnerStatsResponse as GeneratedOwnerStatsResponse,
} from "./generated/api.schemas";
import {
  adminGetBookingAudit,
  useCreateManualBooking as useGeneratedCreateManualBooking,
} from "./generated/api";

export function useCreateManualBooking() {
  const generatedMutation = useGeneratedCreateManualBooking();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateManualBookingRequest) =>
      generatedMutation.mutateAsync({ data }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["/api/owner/bookings"] });
    },
  });
}

export type UpdateOwnerBookingRequest = OwnerBookingUpdate & { id: string };
async function updateOwnerBooking(
  { id, ...body }: UpdateOwnerBookingRequest,
): Promise<CreateManualBookingResponse> {
  return customFetch<CreateManualBookingResponse>(`/api/owner/bookings/${id}`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

export function useUpdateOwnerBooking() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: UpdateOwnerBookingRequest) => updateOwnerBooking(data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["/api/owner/bookings"] });
    },
  });
}

// ─── Booking Audit Log ────────────────────────────────────────────────────────

export type { AuditEntry };
export type AuditLogEntry = AuditEntry;

export interface GetOwnerBookingAuditResponse {
  entries: AuditEntry[];
}

async function getOwnerBookingAudit(bookingId: string): Promise<GetOwnerBookingAuditResponse> {
  return customFetch<GetOwnerBookingAuditResponse>(`/api/owner/bookings/${bookingId}/audit`);
}

export function useGetOwnerBookingAudit(bookingId: string) {
  return useQuery({
    queryKey: ["ownerBookingAudit", bookingId],
    queryFn: () => getOwnerBookingAudit(bookingId),
    enabled: !!bookingId,
  });
}

// ─── Admin Booking Audit — backed by generated adminGetBookingAudit ───────────

export interface GetAdminBookingAuditResponse {
  entries: AuditEntry[];
}

export function useGetAdminBookingAudit(bookingId: string) {
  return useQuery({
    queryKey: ["adminBookingAudit", bookingId],
    queryFn: () => adminGetBookingAudit(bookingId),
    enabled: !!bookingId,
  });
}

export type CreateManualBookingRequest = ManualBookingInput;

export type CreateManualBookingResponse = CreateManualBooking201;

export type OwnerStatsResponse = GeneratedOwnerStatsResponse;
