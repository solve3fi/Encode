// A finalized-transaction source for the Genesis indexer that reads ONLY transactions touching one
// program instead of every block. Devnet produces ~2.5 blocks per second, so scanning every block
// would burn most of an RPC plan; this source asks the RPC for the program's own signatures.
//
// It keeps the indexer's contract: ranges are bounded, slots ascend, failed transactions are
// dropped, and anything the strict decoder cannot verify is skipped (and counted) rather than
// halting the whole index on an unrelated admin instruction. A transaction that is genuinely
// unavailable still fails closed.

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * @param {{
 *  connection: { getSlot: Function, getSignaturesForAddress: Function, getTransaction: Function },
 *  programId: string,
 *  PublicKey: new (value: string) => unknown,
 *  canDecode: (block: object) => Promise<boolean>,
 *  paceMs?: number,
 *  maxRetries?: number,
 *  pageSize?: number,
 * }} options
 */
export function createProgramTransactionSource({
	connection,
	programId,
	PublicKey,
	canDecode,
	paceMs = 150,
	maxRetries = 6,
	pageSize = 1000,
}) {
	if (typeof canDecode !== "function")
		throw new TypeError("A decodability check is required.");
	const program = new PublicKey(programId);
	let capturedFinalized = null;
	let floorSlot = null;
	/** @type {Array<{ signature: string, slot: number, err: unknown }>} */
	let signatures = [];
	const transactions = new Map();
	const stats = { skippedUndecodable: 0, failedTransactions: 0, fetched: 0 };

	async function retried(label, fn) {
		let lastError;
		for (let attempt = 0; attempt <= maxRetries; attempt++) {
			try {
				return await fn();
			} catch (error) {
				lastError = error;
				await sleep(Math.min(8000, 400 * 2 ** attempt));
			}
		}
		throw new Error(`${label} failed after retries`, { cause: lastError });
	}

	return {
		stats: () => ({ ...stats }),
		/**
		 * Capture a consistent cut: the finalized slot first, then every program signature at or
		 * above the floor. Finalization is monotonic, so nothing at or below the captured slot can
		 * appear later.
		 */
		async prime(floor) {
			if (!Number.isSafeInteger(floor) || floor < 0)
				throw new RangeError("Invalid source floor slot.");
			capturedFinalized = await retried("finalized slot", () =>
				connection.getSlot("finalized"),
			);
			const found = [];
			let before;
			for (;;) {
				const page = await retried("signature page", () =>
					connection.getSignaturesForAddress(
						program,
						{ limit: pageSize, ...(before ? { before } : {}) },
						"finalized",
					),
				);
				for (const entry of page)
					if (entry.slot >= floor && entry.slot <= capturedFinalized)
						found.push({
							signature: entry.signature,
							slot: entry.slot,
							err: entry.err,
						});
				if (page.length < pageSize) break;
				const oldest = page[page.length - 1];
				if (oldest.slot < floor) break;
				before = oldest.signature;
				await sleep(paceMs);
			}
			floorSlot = floor;
			signatures = found.sort(
				(a, b) =>
					a.slot - b.slot || (a.signature < b.signature ? -1 : 1),
			);
			return { signatures: signatures.length, capturedFinalized };
		},
		async finalizedSlot() {
			if (capturedFinalized === null)
				throw new Error("The source must be primed before use.");
			return capturedFinalized;
		},
		async readRange(startSlot, endSlot) {
			if (capturedFinalized === null || floorSlot === null)
				throw new Error("The source must be primed before use.");
			if (startSlot < floorSlot || endSlot > capturedFinalized)
				throw new RangeError("Range lies outside the primed source cut.");
			const inRange = signatures.filter(
				(entry) => entry.slot >= startSlot && entry.slot <= endSlot,
			);
			const bySlot = new Map();
			for (const entry of inRange) {
				if (entry.err !== null) {
					stats.failedTransactions++;
					continue;
				}
				let tx = transactions.get(entry.signature);
				if (!tx) {
					await sleep(paceMs);
					tx = await retried("transaction", () =>
						connection.getTransaction(entry.signature, {
							commitment: "finalized",
							maxSupportedTransactionVersion: 1,
						}),
					);
					stats.fetched++;
					if (!tx || tx.slot !== entry.slot || tx.blockTime == null)
						throw new Error("Finalized transaction is unavailable.");
					transactions.set(entry.signature, tx);
				}
				if (tx.meta?.err !== null && tx.meta?.err !== undefined) {
					stats.failedTransactions++;
					continue;
				}
				if (!tx.meta) throw new Error("Finalized transaction has no metadata.");
				const block = {
					slot: tx.slot,
					blockTimeSeconds: tx.blockTime,
					transactions: [tx],
				};
				if (!(await canDecode(block))) {
					stats.skippedUndecodable++;
					continue;
				}
				const list = bySlot.get(tx.slot) ?? {
					slot: tx.slot,
					blockTimeSeconds: tx.blockTime,
					transactions: [],
				};
				list.transactions.push(tx);
				bySlot.set(tx.slot, list);
			}
			return [...bySlot.values()].sort((a, b) => a.slot - b.slot);
		},
	};
}

/** True when the strict decoder accepts this block; any refusal means "skip, do not halt". */
export function decodabilityCheck(decoder) {
	return async (block) => {
		try {
			await decoder.decode(block);
			return true;
		} catch {
			return false;
		}
	};
}
