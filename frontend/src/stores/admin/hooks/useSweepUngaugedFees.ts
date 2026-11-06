import { useWallet } from "@solana/wallet-adapter-react";
import { ComputeBudgetProgram, PublicKey } from "@solana/web3.js";
import { IGNORE_CACHE } from "@solve3fi/sdk";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { notification } from "@/components/Notifications";
import { DEX_PROGRAM_ID, PROGRAM_CONFIG } from "@/configs/addresses";
import { getProtocolPDA, useVesolveProgram } from "@/hooks/useVesolveProgram";
import {
	fetchTreasury,
	sweepUngaugedPoolFeesAccounts,
} from "@/lib/sweepUngaugedFees";
import { useCluster } from "@/providers/ClusterProvider";
import { useClient } from "@/providers/DappProvider";

/** Sends an ungauged pool's 5% protocol share to the Treasury (Admin wallet). */
export function useSweepUngaugedFees() {
	const { publicKey } = useWallet();
	const { network } = useCluster();
	const { ctx } = useClient(DEX_PROGRAM_ID[network]);
	const program = useVesolveProgram();
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: async (poolAddress: string) => {
			if (!publicKey) throw new Error("Connect the Admin wallet.");
			const pool = new PublicKey(poolAddress);
			const [treasury, poolData] = await Promise.all([
				fetchTreasury(program),
				ctx.fetcher.getPool(pool, IGNORE_CACHE),
			]);
			if (!treasury) throw new Error("Set the Treasury first.");
			if (!poolData?.solvesConfig.equals(PROGRAM_CONFIG[network]))
				throw new Error("Pool does not belong to this DEX.");
			return program.methods
				.sweepUngaugedPoolFees()
				.accounts(
					sweepUngaugedPoolFeesAccounts({
						admin: publicKey,
						protocol: getProtocolPDA()[0],
						pool,
						solvesConfig: PROGRAM_CONFIG[network],
						tokenMintA: poolData.tokenMintA,
						tokenMintB: poolData.tokenMintB,
						tokenVaultA: poolData.tokenVaultA,
						tokenVaultB: poolData.tokenVaultB,
						treasury,
						dexProgramId: DEX_PROGRAM_ID[network],
					}),
				)
				.preInstructions([
					ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }),
				])
				.rpc({ commitment: "confirmed" });
		},
		onSuccess: async () => {
			notification.success({
				title: "Pool fees swept",
				message: "The protocol share was sent to the Treasury.",
			});
			await Promise.all(
				["allPools", "poolInfo", "pools"].map((key) =>
					queryClient.invalidateQueries({ queryKey: [key] }),
				),
			);
		},
		onError: (error) => {
			console.error(error);
			notification.error({
				title: "Sweep failed",
				message: error instanceof Error ? error.message : String(error),
			});
		},
	});
}
