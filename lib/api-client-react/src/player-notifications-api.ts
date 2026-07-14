import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "./custom-fetch";

export interface PlayerNotification {
  id: string;
  type: string;
  title: string;
  body: string;
  entityType: string | null;
  entityId: string | null;
  read: boolean;
  createdAt: string;
}

export interface ListPlayerNotificationsResponse {
  notifications: PlayerNotification[];
}

const PLAYER_NOTIFICATIONS_KEY = ["playerNotifications"] as const;

async function fetchPlayerNotifications(): Promise<ListPlayerNotificationsResponse> {
  return customFetch<ListPlayerNotificationsResponse>("/api/player/notifications");
}

async function markPlayerNotificationsRead(id?: string): Promise<{ ok: boolean }> {
  return customFetch<{ ok: boolean }>("/api/player/notifications/read", {
    method: "PATCH",
    body: JSON.stringify(id ? { id } : {}),
  });
}

export function usePlayerNotifications(options?: { refetchInterval?: number }) {
  return useQuery({
    queryKey: PLAYER_NOTIFICATIONS_KEY,
    queryFn: fetchPlayerNotifications,
    refetchInterval: options?.refetchInterval ?? 30_000,
  });
}

export function useMarkPlayerNotificationsRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id?: string) => markPlayerNotificationsRead(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: PLAYER_NOTIFICATIONS_KEY });
    },
  });
}
