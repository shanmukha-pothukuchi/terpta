import { useCallback, useMemo } from "react";
import { useAuth } from "@workos-inc/authkit-react";

/**
 * Adapter between WorkOS AuthKit's `useAuth()` and Convex's
 * `ConvexProviderWithAuth` contract (isLoading / isAuthenticated /
 * fetchAccessToken).
 */
export function useAuthFromAuthKit() {
  const { user, isLoading, getAccessToken } = useAuth();

  const fetchAccessToken = useCallback(
    async ({
      forceRefreshToken,
    }: {
      forceRefreshToken: boolean;
    }): Promise<string | null> => {
      if (!user) {
        return null;
      }
      try {
        return (
          (await getAccessToken({ forceRefresh: forceRefreshToken })) ?? null
        );
      } catch {
        return null;
      }
    },
    [user, getAccessToken],
  );

  return useMemo(
    () => ({
      isLoading,
      isAuthenticated: !!user,
      fetchAccessToken,
    }),
    [isLoading, user, fetchAccessToken],
  );
}
