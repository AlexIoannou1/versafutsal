import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "./custom-fetch";
import type { AuditEntry } from "./generated/api.schemas";
import { adminGetBookingAudit } from "./generated/api";

export interface CreateManualBookingRequest {
  pitchId: string;
  startAt: string;
  guestName: string;
  guestPhone: string;
}

export interface CreateManualBookingResponse {
  booking: {
    id: string;
    venueId: string;
    pitchId: string;
    startAt: string;
    endAt: string;
    status: string;
    guestName: string | null;
    guestPhone: string | null;
    createdAt: string;
    venue: { id: string; name: string; district: string; address: string };
    pitch: { id: string; name: string; type: string; size: string; slotDurationMinutes: number };
  };
}

async function createManualBooking(
  data: CreateManualBookingRequest,
): Promise<CreateManualBookingResponse> {
  return customFetch<CreateManualBookingResponse>("/api/owner/bookings/manual", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export function useCreateManualBooking() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateManualBookingRequest) => createManualBooking(data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["/api/owner/bookings"] });
    },
  });
}

// ─── Update booking ────────────────────────────────────────────────────────────

export interface UpdateOwnerBookingRequest {
  id: string;
  pitchId: string;
  startAt: string;
  guestName?: string;
  guestPhone?: string;
}

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
