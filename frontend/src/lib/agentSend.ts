import type { Connection } from "@solana/web3.js";

/** The transaction ran on-chain and failed. Funds are unchanged (only the network fee was spent). */
export class ChainFailure extends Error {
	constructor(readonly detail: unknown) {
		super("The transaction ran but was rejected by the program.");
	}
}
/** The network never included the transaction before its blockhash expired. Nothing happened; trying again is safe. */
export class NeverLanded extends Error {
	constructor() {
		super("The network didn't confirm it in time and it did not go through. Nothing was charged. Please try again.");
	}
}
/** The blockhash expired before the wallet signed (the approval took too long). */
export class ExpiredBeforeSigning extends Error {
	constructor() {
		super("That took too long to approve and the transaction expired. Press the button again.");
	}
}

type Opts = { pollMs?: number; rebroadcastMs?: number; now?: () => number };

/** Throws ExpiredBeforeSigning if the transaction's blockhash is already too old to be worth signing. */
export async function assertFresh(connection: Pick<Connection, "getBlockHeight">, lastValidBlockHeight: number) {
	if (lastValidBlockHeight > 0 && (await connection.getBlockHeight("confirmed")) >= lastValidBlockHeight)
		throw new ExpiredBeforeSigning();
}

/**
 * Sends a signed transaction and waits until it lands or its blockhash expires, rebroadcasting meanwhile.
 * Busy clusters drop transactions silently, so one send plus a fixed timeout is not enough. The result is always one of:
 * resolves (confirmed), ChainFailure (ran and failed), or NeverLanded (expired without landing).
 */
export async function sendAndConfirmRobust(
	connection: Pick<Connection, "sendRawTransaction" | "getSignatureStatuses" | "getBlockHeight">,
	raw: Uint8Array,
	lastValidBlockHeight: number,
	opts: Opts = {},
): Promise<string> {
	const pollMs = opts.pollMs ?? 1500;
	const rebroadcastMs = opts.rebroadcastMs ?? 4000;
	const now = opts.now ?? Date.now;
	// First send keeps preflight on so an obviously bad transaction is reported immediately.
	const signature = await connection.sendRawTransaction(raw, { maxRetries: 0 });
	let lastSend = now();
	for (;;) {
		const { value } = await connection.getSignatureStatuses([signature], { searchTransactionHistory: false });
		const status = value[0];
		if (status?.err) throw new ChainFailure(status.err);
		if (status && (status.confirmationStatus === "confirmed" || status.confirmationStatus === "finalized")) return signature;

		if (lastValidBlockHeight > 0 && (await connection.getBlockHeight("confirmed")) > lastValidBlockHeight) {
			// One last look: it may have landed in the final slots.
			const final = (await connection.getSignatureStatuses([signature], { searchTransactionHistory: true })).value[0];
			if (final?.err) throw new ChainFailure(final.err);
			if (final && final.confirmationStatus) return signature;
			throw new NeverLanded();
		}
		if (now() - lastSend >= rebroadcastMs) {
			try {
				await connection.sendRawTransaction(raw, { skipPreflight: true, maxRetries: 0 });
			} catch {
				/* a rebroadcast can fail harmlessly (already processed, blockhash expiring): keep waiting */
			}
			lastSend = now();
		}
		await new Promise((r) => setTimeout(r, pollMs));
	}
}
