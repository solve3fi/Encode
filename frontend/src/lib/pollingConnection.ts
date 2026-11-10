import {
	type Commitment,
	Connection,
	type RpcResponseAndContext,
	type SignatureResult,
	TransactionExpiredBlockheightExceededError,
	TransactionExpiredTimeoutError,
} from "@solana/web3.js";

const RANK: Record<string, number> = { processed: 0, confirmed: 1, finalized: 2 };
const POLL_MS = 1_000;
const HEIGHT_CHECK_MS = 4_000;
const GIVE_UP_MS = 120_000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type Strategy = string | { signature: string; lastValidBlockHeight?: number };

/**
 * A Connection that confirms transactions by asking our own RPC for the signature status, once a second. The stock
 * confirmTransaction waits on a websocket subscription; on the shared public websocket that can drop silently, and the
 * app then waits until the transaction expires even though it landed ("Swap timed out").
 */
export class PollingConnection extends Connection {
	async confirmTransaction(strategy: Strategy, commitment?: Commitment): Promise<RpcResponseAndContext<SignatureResult>> {
		const signature = typeof strategy === "string" ? strategy : strategy.signature;
		const lastValid = typeof strategy === "string" ? undefined : strategy.lastValidBlockHeight;
		const wanted = RANK[commitment ?? this.commitment ?? "finalized"] ?? RANK.finalized;
		const started = Date.now();
		let lastHeightCheck = 0;
		for (;;) {
			let status: Awaited<ReturnType<Connection["getSignatureStatuses"]>> | null = null;
			try {
				status = await this.getSignatureStatuses([signature], { searchTransactionHistory: true });
			} catch {
				// A slow or failed read is not a failed transaction: keep polling.
			}
			const found = status?.value[0];
			if (status && found) {
				if (found.err) return { context: status.context, value: { err: found.err } };
				const have = found.confirmationStatus ?? (found.confirmations === null ? "finalized" : "processed");
				if ((RANK[have] ?? 0) >= wanted) return { context: status.context, value: { err: null } };
			} else if (lastValid !== undefined && Date.now() - lastHeightCheck >= HEIGHT_CHECK_MS) {
				lastHeightCheck = Date.now();
				try {
					const height = await this.getBlockHeight("confirmed");
					if (height > lastValid) {
						// One last look before declaring it expired: the status may have landed while we checked.
						const again = await this.getSignatureStatuses([signature], { searchTransactionHistory: true });
						if (!again.value[0]) throw new TransactionExpiredBlockheightExceededError(signature);
					}
				} catch (error) {
					if (error instanceof TransactionExpiredBlockheightExceededError) throw error;
				}
			}
			if (Date.now() - started > GIVE_UP_MS) throw new TransactionExpiredTimeoutError(signature, GIVE_UP_MS / 1000);
			await sleep(POLL_MS);
		}
	}
}
