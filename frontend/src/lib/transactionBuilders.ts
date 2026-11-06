import type { Signer, Transaction, TransactionInstruction } from "@solana/web3.js";

/** The parts of an SDK `TransactionBuilder` that a claim transaction needs. */
type BuilderLike = {
	compressIx(compressPost: boolean): {
		instructions: TransactionInstruction[];
		cleanupInstructions: TransactionInstruction[];
		signers: Signer[];
	};
};

/**
 * Adds SDK builders to a transaction and returns the extra signers they need.
 * `compressIx(true)` appends each builder's cleanup instructions (for example the close of
 * a temporary wrapped-SOL account), and the returned signers must be passed to
 * `sendAndConfirm`: dropping either breaks any pool that holds native SOL.
 */
export function addBuilders(
	transaction: Transaction,
	builders: BuilderLike[],
): Signer[] {
	const signers: Signer[] = [];
	for (const builder of builders) {
		const compressed = builder.compressIx(true);
		transaction.add(...compressed.instructions);
		signers.push(...compressed.signers);
	}
	return signers;
}
