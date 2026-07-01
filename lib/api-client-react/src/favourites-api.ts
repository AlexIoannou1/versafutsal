import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "./custom-fetch";

export interface FavouriteVenueSummary {
  id: string;
  name: string;
  district: string;
  address: string;
  amenities: string[];
  coverPhoto: string | null;
  minPrice: number | null;
  maxPrice: number | null;
  pitchTypes: string[];
}

export interface ListFavouritesResponse {
  venues: FavouriteVenueSummary[];
  favouriteVenueIds: string[];
}

export interface FavouriteIdsResponse {
  venueIds: string[];
}

const FAVOURITES_KEY = "/api/player/favourites";
const FAVOURITES_IDS_KEY = "/api/player/favourites/ids";

async function listFavourites(): Promise<ListFavouritesResponse> {
  return customFetch<ListFavouritesResponse>(FAVOURITES_KEY);
}

async function getFavouriteIds(): Promise<FavouriteIdsResponse> {
  return customFetch<FavouriteIdsResponse>(FAVOURITES_IDS_KEY);
}

async function addFavourite(venueId: string): Promise<{ ok: boolean }> {
  return customFetch<{ ok: boolean }>(`/api/player/favourites/${venueId}`, {
    method: "POST",
  });
}

async function removeFavourite(venueId: string): Promise<{ ok: boolean }> {
  return customFetch<{ ok: boolean }>(`/api/player/favourites/${venueId}`, {
    method: "DELETE",
  });
}

export function useListFavourites() {
  return useQuery({
    queryKey: [FAVOURITES_KEY],
    queryFn: listFavourites,
  });
}

export function useFavouriteIds() {
  return useQuery({
    queryKey: [FAVOURITES_IDS_KEY],
    queryFn: getFavouriteIds,
  });
}

export function useToggleFavourite() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      venueId,
      isFavourited,
    }: {
      venueId: string;
      isFavourited: boolean;
    }) => {
      if (isFavourited) {
        return removeFavourite(venueId);
      } else {
        return addFavourite(venueId);
      }
    },
    onMutate: async ({ venueId, isFavourited }) => {
      await queryClient.cancelQueries({ queryKey: [FAVOURITES_IDS_KEY] });
      await queryClient.cancelQueries({ queryKey: [FAVOURITES_KEY] });

      const prevIds = queryClient.getQueryData<FavouriteIdsResponse>([FAVOURITES_IDS_KEY]);
      const prevList = queryClient.getQueryData<ListFavouritesResponse>([FAVOURITES_KEY]);

      queryClient.setQueryData<FavouriteIdsResponse>([FAVOURITES_IDS_KEY], (old) => {
        if (!old) return old;
        const ids = isFavourited
          ? old.venueIds.filter((id) => id !== venueId)
          : [...old.venueIds, venueId];
        return { venueIds: ids };
      });

      if (isFavourited) {
        queryClient.setQueryData<ListFavouritesResponse>([FAVOURITES_KEY], (old) => {
          if (!old) return old;
          return {
            ...old,
            venues: old.venues.filter((v) => v.id !== venueId),
            favouriteVenueIds: old.favouriteVenueIds.filter((id) => id !== venueId),
          };
        });
      }

      return { prevIds, prevList };
    },
    onError: (_err, _vars, context) => {
      if (context?.prevIds) {
        queryClient.setQueryData([FAVOURITES_IDS_KEY], context.prevIds);
      }
      if (context?.prevList) {
        queryClient.setQueryData([FAVOURITES_KEY], context.prevList);
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: [FAVOURITES_IDS_KEY] });
      void queryClient.invalidateQueries({ queryKey: [FAVOURITES_KEY] });
    },
  });
}
