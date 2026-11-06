import { useLingui } from "@lingui/react";
import { useWallet } from "@solana/wallet-adapter-react";
import { Transaction } from "@solana/web3.js";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { notification } from "@/components/Notifications";
import { DEX_PROGRAM_ID } from "@/configs/addresses";
import { useAllPositions } from "@/hooks/useAllPositions";
import { buildVoteRewardClaimIxs } from "@/hooks/useClaimVoteRewards";
import { usePositions } from "@/hooks/usePositions";
import { useVesolveProgram } from "@/hooks/useVesolveProgram";
import { useVoteRewards } from "@/hooks/useVoteRewards";
import { addBuilders } from "@/lib/transactionBuilders";
import { useCluster } from "@/providers/ClusterProvider";
import { useClient } from "@/providers/DappProvider";

/**
 * Claims everything a connected wallet has outstanding: LP-side trading
 * fees + AMM native rewards for every liquidity position (regardless of
 * whether its pool has a gauge, and including positions in unlisted-token
 * pools), plus every gauge's voting reward (emission share, swept fees,
 * bribes) a lock has earned. This is deliberately the union of what the
 * Liquidity and Voting tabs each claim individually -- "Claim All Rewards"
 * ignores which tab is active.
 */
export const useClaimAllRewards = () => {
	const { i18n } = useLingui();
	const { publicKey } = useWallet();
	const { network } = useCluster();
	const { ctx } = useClient(DEX_PROGRAM_ID[network]);
	const vesolveProgram = useVesolveProgram();
	const queryClient = useQueryClient();

	const { data: allPositions } = useAllPositions();
	const { data: positions } = usePositions(allPositions);
	const { data: voteRewardRows } = useVoteRewards();

	return useMutation({
		mutationKey: ["claimAllRewards"],
		mutationFn: async () => {
			if (!publicKey) throw new Error("Connect Wallet");
			let claimedCount = 0;
			const failures: unknown[] = [];

			// One failing position or row must not block the rest, so each is claimed on its own.
			// usePositions returns a record keyed by address (null for closed positions), not an array.
			for (const position of Object.values(positions ?? {})) {
				if (!position) continue;
				try {
					const transaction = new Transaction();
					// Signers and cleanup instructions matter for pools that hold native SOL.
					const signers = addBuilders(transaction, [
						...(await position.collectRewards()),
						await position.collectFees(),
					]);
					const signature = await ctx.provider.sendAndConfirm(transaction, signers);
					await ctx.connection.confirmTransaction(signature, "confirmed");
					claimedCount++;
				} catch (error) {
					console.error("claim position failed", error);
					failures.push(error);
				}
			}

			for (const row of voteRewardRows ?? []) {
				try {
					const ixs = await buildVoteRewardClaimIxs(vesolveProgram, publicKey, row);
					if (ixs.length === 0) continue;
					const transaction = new Transaction().add(...ixs);
					const signature = await vesolveProgram.provider.sendAndConfirm?.(
						transaction,
					);
					if (signature) {
						await vesolveProgram.provider.connection.confirmTransaction(
							signature,
							"confirmed",
						);
					}
					claimedCount++;
				} catch (error) {
					console.error("claim vote reward failed", error);
					failures.push(error);
				}
			}

			// Nothing claimed and something failed: surface the first error.
			if (claimedCount === 0 && failures.length > 0) throw failures[0];
			return { claimedCount, failedCount: failures.length };
		},
		onSuccess: async ({ claimedCount, failedCount }) => {
			if (claimedCount === 0) {
				notification.success({
					title: i18n._("Rewards"),
					message: i18n._("Nothing to claim right now."),
				});
				return;
			}
			if (failedCount > 0) {
				notification.error({
					title: i18n._("Rewards"),
					message: i18n._("Claimed {count} rewards; {failed} could not be claimed.", {
						count: claimedCount,
						failed: failedCount,
					}),
				});
			} else {
				notification.success({
					title: i18n._("Rewards"),
					message: i18n._("Claimed {count} rewards!", { count: claimedCount }),
				});
			}
			await Promise.all([
				queryClient.invalidateQueries({ queryKey: ["totalClaimableRewardsQuote"] }),
				queryClient.invalidateQueries({ queryKey: ["vesolve-vote-rewards"] }),
			]);
		},
		onError: (error) => {
			console.error(error);
			notification.error({
				title: i18n._("Rewards"),
				message: i18n._("Some rewards could not be claimed."),
			});
		},
	});
};
