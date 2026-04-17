import { useQuery, useQueryClient } from "@tanstack/react-query";

import { listVaultS3ObjectsFlat, type VaultS3ListObject } from "@/lib/storage";

/** Plan / cache key: `['vaultObjects', profileId]`. */
export function vaultObjectsQueryKey(profileId: string | null) {
  return ["vaultObjects", profileId] as const;
}

export function useVaultS3Objects(profileId: string | null) {
  return useQuery<VaultS3ListObject[]>({
    queryKey: vaultObjectsQueryKey(profileId),
    queryFn: async () => {
      if (!profileId) return [];
      const { data, error } = await listVaultS3ObjectsFlat(profileId);
      if (error) throw new Error(error.message);
      return data;
    },
    enabled: Boolean(profileId),
    staleTime: 2 * 60 * 1000,
  });
}

export function useInvalidateVaultS3() {
  const qc = useQueryClient();
  return (profileId: string | null) => {
    void qc.invalidateQueries({ queryKey: vaultObjectsQueryKey(profileId) });
  };
}
