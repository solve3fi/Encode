import type { Percentage } from "@solve3fi/common";
import { useWallet } from "@solana/wallet-adapter-react";
import { useMutation } from "@tanstack/react-query";
import { DEX_PROGRAM_ID } from "@/configs/addresses";
import {
	assertGenesisTokenPairAllowed,
	GENESIS_PUBLIC_ENABLED,
} from "@/configs/genesis";
import {
	formatSwapAmount,
	type SwapResultData,
	type SwapSummary,
} from "@/components/Swap/swapResult";
import type { BestTrade } from "@/hooks/useBestTrade";
import { mapTransactionError } from "@/lib/transactionErrors";
import { useCluster } from "@/providers/ClusterProvider";
import { useClient } from "@/providers/DappProvider";
import { ModalType } from "@/stores/modal";
import { useModalActions } from "@/stores/modal/ModalProvider";

export type SwapData = {
	trade: BestTrade;
	slippage: Percentage;
	summary: SwapSummary;
};

export const useSwap = () => {
	const { network } = useCluster();
	const { ctx } = useClient(DEX_PROGRAM_ID[network]);
	const { setOpenModal } = useModalActions();
	const { publicKey } = useWallet();
	const show = (result: SwapResultData) =>
		setOpenModal(ModalType.SWAP_SUCCESS, result);
	return useMutation({
		mutationKey: ["swap"],
		mutationFn: async (data: SwapData) => {
			const { trade, slippage, summary } = data;
			if (!trade || !trade.router || !trade.routers) {
				throw new Error("Trade is undefined");
			}
			if (GENESIS_PUBLIC_ENABLED && !trade.request) {
				throw new Error("Swap token details are unavailable during Genesis.");
			}
			if (trade.request) {
				assertGenesisTokenPairAllowed(
					trade.request.tokenIn.toString(),
					trade.request.tokenOut.toString(),
				);
			}
			if (GENESIS_PUBLIC_ENABLED) {
				for (const subRoute of trade.routers.subRoutes) {
					for (const hop of subRoute.hopQuotes) {
						assertGenesisTokenPairAllowed(
							hop.inputMint.toString(),
							hop.outputMint.toString(),
						);
					}
				}
			}

			const tx = await trade.router.swap(trade.routers, slippage, null);

			const signature = await tx.buildAndExecute({
				maxSupportedTransactionVersion: trade.alts ? 0 : "legacy",
				lookupTableAccounts: trade.alts,
				blockhashCommitment: "finalized",
			});

			// The signature exists once the transaction has been sent: show it pending now.
			show({ status: "pending", summary, signature });

			const latest_blockhash = await ctx.connection.getLatestBlockhash();
			const confirmation = await ctx.connection.confirmTransaction(
				{ signature, ...latest_blockhash },
				"confirmed",
			);
			if (confirmation.value.err) {
				throw Object.assign(
					new Error(JSON.stringify(confirmation.value.err)),
					{ signature },
				);
			}

			// Real fee and received amount come from the confirmed transaction; fall
			// back to the quote when the node cannot return it yet.
			let fee: number | undefined;
			let received: string | undefined;
			try {
				const confirmed = await ctx.connection.getTransaction(signature, {
					commitment: "confirmed",
					maxSupportedTransactionVersion: 0,
				});
				if (confirmed?.meta) {
					fee = confirmed.meta.fee / 1e9;
					const owner = publicKey?.toBase58();
					const mint = trade.request?.tokenOut?.toString();
					if (owner && mint) {
						const sum = (
							balances: typeof confirmed.meta.postTokenBalances,
						) =>
							(balances ?? [])
								.filter((b) => b.owner === owner && b.mint === mint)
								.reduce((total, b) => total + (b.uiTokenAmount.uiAmount ?? 0), 0);
						const delta =
							sum(confirmed.meta.postTokenBalances) -
							sum(confirmed.meta.preTokenBalances);
						if (delta > 0) received = formatSwapAmount(delta);
					}
				}
			} catch (readError) {
				console.warn("Could not read confirmed swap transaction", readError);
			}

			show({ status: "success", summary, signature, fee, received });
		},
		onError: (error, variables) => {
			console.error(error);
			const signature = (error as { signature?: string }).signature;
			show({
				status: "failed",
				summary: variables.summary,
				signature,
				error: mapTransactionError(error).message,
			});
		},
	});
};
