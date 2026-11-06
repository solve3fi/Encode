const EXPIRED = /blockhash not found|block height exceeded|transaction expired|expired before/i;

const message = (error: unknown) => {
	const e = error as { message?: unknown; logs?: unknown } | null;
	return `${String(e?.message ?? error)} ${JSON.stringify(e?.logs ?? "")}`;
};

/** A wallet approval that takes longer than a blockhash lives leaves an expired transaction. */
export const isExpiredTransactionError = (error: unknown) =>
	EXPIRED.test(message(error));

/**
 * Sends a transaction and, if it expired while waiting for the wallet, builds it again with a
 * fresh blockhash and sends it once more. `send` must build the transaction on every call.
 */
export async function retryIfExpired<T>(send: () => Promise<T>): Promise<T> {
	try {
		return await send();
	} catch (error) {
		if (!isExpiredTransactionError(error)) throw error;
		return await send();
	}
}
