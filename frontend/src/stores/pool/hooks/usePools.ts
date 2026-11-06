import type { ClusterNetwork } from "@/providers/ClusterProvider";
import { usePools as usePoolsByAddress } from "@/hooks/usePools";

// Adapter matching the (network, addresses) call signature used by the Vote
// feature. `network` is accepted for API parity with how it's called, but
// the underlying hook already derives the active network itself via
// useCluster(), so a mismatched `network` argument here would be misleading
// rather than functional — callers should rely on the connected cluster.
export const usePools = (
	_network: ClusterNetwork,
	addresses: string[] | undefined,
) => usePoolsByAddress(addresses);
