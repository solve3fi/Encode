import { DecimalUtil } from "@solve3fi/common";
import { getMint } from "@solana/spl-token";
import { useQuery } from "@tanstack/react-query";
import BN from "bn.js";
import {
	getProtocolPDA,
	useVesolveProgram,
	vesolveAccount,
} from "@/hooks/useVesolveProgram";
import { useAnchor } from "@/providers/DappProvider";

export type EmissionsHistoryPoint = {
	epoch: number;
	emissions: number;
};

/**
 * Total emission-reward tokens distributed per epoch, across every gauge's
 * Vault — i.e. how many reward tokens the protocol has actually handed out
 * over time (via distribute_reward), not a placeholder. Real on-chain data,
 * grouped and summed client-side since there's no indexer.
 */
export const useEmissionsHistory = () => {
	const program = useVesolveProgram();
	const { connection } = useAnchor();

	return useQuery({
		queryKey: ["vesolve-emissions-history"],
		queryFn: async (): Promise<EmissionsHistoryPoint[]> => {
			const [protocolAddress] = getProtocolPDA();
			const [protocol, vaults] = await Promise.all([
				vesolveAccount.protocol(program).fetchNullable(protocolAddress),
				vesolveAccount.vault(program).all(),
			]);
			if (!protocol) return [];

			const rewardMintInfo = await getMint(
				connection,
				protocol.tokenMint,
			).catch(() => null);
			const decimals = rewardMintInfo?.decimals ?? 9;

			const byEpoch = new Map<number, BN>();
			for (const { account } of vaults) {
				const epoch = account.epoch.toNumber();
				byEpoch.set(
					epoch,
					(byEpoch.get(epoch) ?? new BN(0)).add(account.rewards),
				);
			}

			return Array.from(byEpoch.entries())
				.sort(([a], [b]) => a - b)
				.map(([epoch, rewards]) => ({
					epoch,
					emissions: DecimalUtil.fromBN(rewards, decimals).toNumber(),
				}));
		},
	});
};
