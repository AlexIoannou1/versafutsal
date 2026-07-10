import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "./custom-fetch";

export interface OwnerNotification {
  id: string;
  type: string;
  title: string;
  body: string;
  entityType: string | null;
  entityId: string | null;
  read: boolean;
  createdAt: string;
}

export interface ListOwnerNotificationsResponse {
  notifications: OwnerNotification[];
}

const OWNER_NOTIFICATIONS_KEY = ["ownerNotifications"] as const;

async function fetchOwnerNotifications(): Promise<ListOwnerNotificationsResponse> {
  return customFetch<ListOwnerNotificationsResponse>("/api/owner/notifications");
}

async function markNotificationsRead(id?: string): Promise<{ ok: boolean }> {
  return customFetch<{ ok: boolean }>("/api/owner/notifications/read", {
    method: "PATCH",
    body: JSON.stringify(id ? { id } : {}),
  });
}

export function useOwnerNotifications(options?: { refetchInterval?: number }) {
  return useQuery({
    queryKey: OWNER_NOTIFICATIONS_KEY,
    queryFn: fetchOwnerNotifications,
    refetchInterval: options?.refetchInterval ?? 30_000,
  });
}

export function useMarkNotificationsRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id?: string) => markNotificationsRead(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: OWNER_NOTIFICATIONS_KEY });
    },
  });
}
