import { useQuery, useQueryClient } from "@tanstack/react-query";

import { listVaultS3ObjectsFlat, type VaultS3ListObject } from "@/lib/storage";

export function vaultS3QueryKey(profileId: string | null) {
  return ["vaultS3Objects", profileId] as const;
}

export function useVaultS3Objects(profileId: string | null) {
  return useQuery<VaultS3ListObject[]>({
    queryKey: vaultS3QueryKey(profileId),
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
    void qc.invalidateQueries({ queryKey: vaultS3QueryKey(profileId) });
  };
}
