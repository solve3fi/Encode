import { poll } from "@/lib/poll";
import { getMint } from "@solana/spl-token";
import type { TokenInfo } from "@solana/spl-token-registry";
import { useConnection } from "@solana/wallet-adapter-react";
import type { PublicKey } from "@solana/web3.js";
import type { Solve } from "@solve3fi/sdk";
import { useQuery } from "@tanstack/react-query";
import BN from "bn.js";
import { HIDDEN_POOL_ADDRESSES } from "@/configs/hiddenPools";
import { SUPPORT_MINT_TOKENS } from "@/configs/lock";
import {
	getEpochPDA,
	useVesolveProgram,
	vesolveAccount,
} from "@/hooks/useVesolveProgram";
import type { ClusterNetwork } from "@/providers/ClusterProvider";

// Locally-defined replacement for @solve33/common's BribesInfo — that
// package targets an unrelated, non-deployed program, so its type isn't a
// meaningful source of truth here even though the shape is compatible.
export type BribeInfo = {
	mint: PublicKey;
	mintInfo: { symbol: string; decimals: number };
	vaultInfo: { amount: BN };
	decimalsUnavailable?: boolean;
};

export type VotePerGauge = {
	gauge: PublicKey;
	pool: PublicKey;
	bribesInfos: BribeInfo[];
	tradingFeesA: BN;
	tradingFeesB: BN;
};

// VoteInfo is produced by merging a Solve pool (from usePools) with the
// per-gauge vote record below — see VoteLists.tsx, which does that merge.
// tokenAInfo/tokenBInfo/feeTier are plain properties here (rather than the
// getTokenAInfo()/getTokenBInfo()/getData().feeRate methods Solve actually
// exposes) because that's the shape this UI's render code was written
// against — VoteLists.tsx attaches them at construction time to match.
export type VoteInfo = Solve & {
	tokenAInfo: TokenInfo;
	tokenBInfo: TokenInfo;
	feeTier: { fee: number };
	vote?: VotePerGauge;
	total?: BN;
	votes: BN;
	// USD value of this gauge's current-epoch bribes/fees, priced once for the
	// whole list (see VoteLists.tsx) so bribes can be shown and sorted without
	// each row independently re-deriving devnet spot prices. 0 when unpriced.
	bribesUsd: number;
	feesUsd: number;
	rewardsUsd: number;
	tvlUsd: number;
};

export const useVotes = (network: ClusterNetwork, epoch: number) => {
	const program = useVesolveProgram();
	const { connection } = useConnection();

	return useQuery({
		queryKey: ["vesolve-votes", network, epoch],
		queryFn: async (): Promise<VotePerGauge[]> => {
			// List every gauge that exists, not just ones the current epoch
			// already has a weight entry for — a gauge only gets a
			// gaugeWeights entry once someone votes for it, so restricting to
			// that here made newly-created gauges permanently unvotable (they
			// never appear in the list, so nobody can cast the first vote).
			// The epoch is only consulted for the *current* weight/bribes of
			// each gauge, defaulting to zero/empty when absent.
			const [epochAddress] = getEpochPDA(epoch);
			const [gauges, epochAccount, vaults] = await Promise.all([
				vesolveAccount.gauge(program).all(),
				vesolveAccount.epoch(program).fetchNullable(epochAddress),
				vesolveAccount.vault(program).all(),
			]);

			return await Promise.all(
				gauges
					.filter(
						({ account }) =>
							account.isActive &&
							!HIDDEN_POOL_ADDRESSES.has(account.poolAddress.toBase58()),
					)
					.map(async ({ publicKey: gaugeAddress, account: gauge }) => {
						const vault = vaults.find(
							({ account }) =>
								account.epoch.toString() === String(epoch) &&
								account.gauge.equals(gaugeAddress),
						)?.account;
						const bribeWeights =
							epochAccount?.bribes.filter((bribe) =>
								bribe.gauge.equals(gaugeAddress),
							) ?? [];
						const bribesInfos = await Promise.all(
							bribeWeights.map(async (bribe): Promise<BribeInfo> => {
								const known = SUPPORT_MINT_TOKENS[bribe.tokenMint.toBase58()];
								if (known) {
									return {
										mint: bribe.tokenMint,
										mintInfo: {
											symbol: known.symbol,
											decimals: known.decimals,
										},
										vaultInfo: { amount: bribe.amount },
									};
								}
								const mintInfo = await getMint(
									connection,
									bribe.tokenMint,
								).catch(() => null);
								return {
									mint: bribe.tokenMint,
									mintInfo: {
										symbol: `${bribe.tokenMint.toBase58().slice(0, 4)}…`,
										decimals: mintInfo?.decimals ?? 0,
									},
									decimalsUnavailable: !mintInfo,
									vaultInfo: { amount: bribe.amount },
								};
							}),
						);

						return {
							gauge: gaugeAddress,
							pool: gauge.poolAddress,
							bribesInfos,
							tradingFeesA: vault?.poolRewardsA ?? new BN(0),
							tradingFeesB: vault?.poolRewardsB ?? new BN(0),
						};
					}),
			);
		},
		enabled: epoch > 0,
		refetchInterval: poll(15_000),
	});
};
