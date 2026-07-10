import { useMutation, useQuery, useQueries, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "./custom-fetch";

export type BlockType = "OFF_DAY" | "BANK_HOLIDAY" | "TRAINING" | "MAINTENANCE" | "PRIVATE";

export interface AvailabilityBlock {
  id: string;
  venueId: string;
  pitchId: string | null;
  blockType: BlockType;
  label: string | null;
  startDate: string;
  endDate: string;
  startTime: string | null;
  endTime: string | null;
  recursWeekly: boolean;
  dayOfWeek: number | null;
  createdAt: string;
}

export interface ListBlocksResponse {
  blocks: AvailabilityBlock[];
}

export interface CreateBlockRequest {
  pitchId?: string;
  blockType?: BlockType;
  label?: string;
  startDate: string;
  endDate: string;
  startTime?: string;
  endTime?: string;
  recursWeekly?: boolean;
  dayOfWeek?: number;
}

export interface CreateBlockResponse {
  block: AvailabilityBlock;
  warning?: string;
  conflictingBookings?: { id: string; startAt: string; endAt: string; status: string; pitchId: string }[];
}

function blocksQueryKey(venueId: string) {
  return ["availabilityBlocks", venueId] as const;
}

async function listBlocks(venueId: string): Promise<ListBlocksResponse> {
  return customFetch<ListBlocksResponse>(`/api/owner/venues/${venueId}/blocks`);
}

async function createBlock(venueId: string, data: CreateBlockRequest): Promise<CreateBlockResponse> {
  return customFetch<CreateBlockResponse>(`/api/owner/venues/${venueId}/blocks`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

async function deleteBlock(venueId: string, blockId: string): Promise<void> {
  return customFetch<void>(`/api/owner/venues/${venueId}/blocks/${blockId}`, {
    method: "DELETE",
  });
}

export function useListBlocks(venueId: string) {
  return useQuery({
    queryKey: blocksQueryKey(venueId),
    queryFn: () => listBlocks(venueId),
    enabled: !!venueId,
  });
}

export function useCreateBlock(venueId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateBlockRequest) => createBlock(venueId, data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: blocksQueryKey(venueId) });
    },
  });
}

export function useDeleteBlock(venueId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (blockId: string) => deleteBlock(venueId, blockId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: blocksQueryKey(venueId) });
    },
  });
}

export function useListBlocksForVenues(venueIds: string[]) {
  const results = useQueries({
    queries: venueIds.map((venueId) => ({
      queryKey: blocksQueryKey(venueId),
      queryFn: () => listBlocks(venueId),
      enabled: !!venueId,
    })),
  });
  const allBlocks = results.flatMap((r) => r.data?.blocks ?? []);
  const isLoading = results.some((r) => r.isLoading);
  return { allBlocks, isLoading };
}
