import type { FinalizedBlock, FinalizedSource } from "./indexer";

export type FinalizedRpc<
	Transaction extends { meta: { err: unknown } | null },
> = {
	getSlot(commitment: "finalized"): Promise<number>;
	getBlocks(
		start: number,
		end: number,
		commitment: "finalized",
	): Promise<number[]>;
	getBlock(
		slot: number,
		options: {
			commitment: "finalized";
			transactionDetails: "full";
			maxSupportedTransactionVersion: 1;
		},
	): Promise<{
		blockTime: number | null;
		transactions: readonly Transaction[];
	} | null>;
};

/** Wraps Solana RPC without signing or submitting transactions. */
export function createFinalizedSolanaSource<
	Transaction extends { meta: { err: unknown } | null },
>(rpc: FinalizedRpc<Transaction>): FinalizedSource<Transaction> {
	return {
		finalizedSlot: () => rpc.getSlot("finalized"),
		async readRange(startSlot, endSlot) {
			const slots = await rpc.getBlocks(startSlot, endSlot, "finalized");
			const blocks: FinalizedBlock<Transaction>[] = [];
			let previous = startSlot - 1;
			for (const slot of slots) {
				if (
					!Number.isSafeInteger(slot) ||
					slot < startSlot ||
					slot > endSlot ||
					slot <= previous
				) {
					throw new Error("RPC returned an invalid finalized slot list.");
				}
				previous = slot;
				const block = await rpc.getBlock(slot, {
					commitment: "finalized",
					transactionDetails: "full",
					maxSupportedTransactionVersion: 1,
				});
				if (
					!block ||
					block.blockTime === null ||
					!Number.isSafeInteger(block.blockTime) ||
					block.blockTime < 0
				) {
					throw new Error(
						`Finalized block ${slot} is unavailable or missing time.`,
					);
				}
				const transactions: Transaction[] = [];
				for (const transaction of block.transactions) {
					if (!transaction.meta)
						throw new Error(
							`Finalized block ${slot} has missing transaction metadata.`,
						);
					if (transaction.meta.err === null) transactions.push(transaction);
				}
				blocks.push({ slot, blockTimeSeconds: block.blockTime, transactions });
			}
			return blocks;
		},
	};
}
