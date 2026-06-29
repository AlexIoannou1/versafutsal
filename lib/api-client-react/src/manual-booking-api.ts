import { useMutation, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "./custom-fetch";

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
