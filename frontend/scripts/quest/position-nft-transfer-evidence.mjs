import { createHash } from "node:crypto";
import { PublicKey } from "@solana/web3.js";

const TOKEN = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const TOKEN2022 = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
const validIndex = (value, keys) =>
	Number.isSafeInteger(value) && value >= 0 && value < keys.length;
function address(value) {
	if (typeof value !== "string" || new PublicKey(value).toBase58() !== value)
		throw new Error("NFT transfer: canonical address required");
	return value;
}
function balances(rows, keys, byMint) {
	if (!Array.isArray(rows))
		throw new Error("NFT transfer: complete token balances required");
	const seen = new Set(),
		result = new Map();
	for (const row of rows) {
		if (
			!Number.isSafeInteger(row.accountIndex) ||
			row.accountIndex < 0 ||
			!keys[row.accountIndex] ||
			seen.has(row.accountIndex)
		)
			throw new Error("NFT transfer: invalid or duplicate token balance index");
		seen.add(row.accountIndex);
		if (!byMint.has(row.mint)) continue;
		if (
			row.programId !== TOKEN ||
			row.uiTokenAmount?.decimals !== 0 ||
			!["0", "1"].includes(row.uiTokenAmount.amount)
		)
			throw new Error("NFT transfer: legacy zero-decimal NFT balance required");
		result.set(row.accountIndex, {
			mint: row.mint,
			owner: address(row.owner),
			amount: row.uiTokenAmount.amount,
		});
	}
	return result;
}

/**
 * Direct legacy SPL transfers only. Caller provides successful finalized RPC
 * transactions and verified selected position inventory. Not a range collector,
 * ownership interval, Passport projection or chain/finality verifier.
 */
export function decodePositionNftTransferEvidence({
	network,
	finality,
	campaignId,
	programId,
	slot,
	blockTimeSeconds,
	inventory,
	transactions,
}) {
	if (
		network !== "DEVNET" ||
		finality !== "finalized" ||
		typeof campaignId !== "string" ||
		!campaignId.trim() ||
		!Number.isSafeInteger(slot) ||
		slot < 0 ||
		!Number.isSafeInteger(blockTimeSeconds) ||
		blockTimeSeconds < 0 ||
		blockTimeSeconds > 8640000000000 ||
		!Array.isArray(inventory) ||
		inventory.length < 1 ||
		inventory.length > 256 ||
		!Array.isArray(transactions) ||
		transactions.length > 2048
	)
		throw new Error("NFT transfer: bounded finalized Devnet input required");
	address(programId);
	const byMint = new Map(),
		selectedTokens = new Set();
	for (const row of inventory) {
		const mint = address(row?.positionMint),
			position = address(row.positionAddress),
			token = address(row.tokenAccountAddress);
		const derived = PublicKey.findProgramAddressSync(
			[Buffer.from("position"), new PublicKey(mint).toBuffer()],
			new PublicKey(programId),
		)[0].toBase58();
		if (derived !== position || byMint.has(mint) || selectedTokens.has(token))
			throw new Error(
				"NFT transfer: invalid or duplicate selected position inventory",
			);
		byMint.set(mint, { positionAddress: position, positionMint: mint });
		selectedTokens.add(token);
	}
	const unique = new Map();
	const signaturesByIndex = new Map();
	for (const response of transactions) {
		const { transaction, meta } = response ?? {};
		if (
			!meta ||
			meta.err !== null ||
			!Array.isArray(meta.innerInstructions) ||
			response.slot !== slot ||
			!Number.isSafeInteger(response.transactionIndex) ||
			response.transactionIndex < 0 ||
			response.blockTime !== blockTimeSeconds ||
			typeof transaction?.signatures?.[0] !== "string" ||
			!transaction.signatures[0]
		)
			throw new Error(
				"NFT transfer: successful matching RPC context and inner instructions required",
			);
		const message = transaction.message;
		if (
			signaturesByIndex.has(response.transactionIndex) &&
			signaturesByIndex.get(response.transactionIndex) !==
				transaction.signatures[0]
		)
			throw new Error("NFT transfer: conflicting block transaction index");
		signaturesByIndex.set(response.transactionIndex, transaction.signatures[0]);
		const keys = [
			...message.staticAccountKeys,
			...(meta.loadedAddresses?.writable ?? []),
			...(meta.loadedAddresses?.readonly ?? []),
		].map((key) => address(key.toBase58()));
		const pre = balances(meta.preTokenBalances, keys, byMint),
			post = balances(meta.postTokenBalances, keys, byMint);
		const tracked = new Set([...pre.keys(), ...post.keys()]);
		keys.forEach((key, index) => {
			if (byMint.has(key) || selectedTokens.has(key)) tracked.add(index);
		});
		const touched = (accounts) => accounts.some((index) => tracked.has(index));
		const innerGroups = new Set();
		for (const group of meta.innerInstructions) {
			if (
				!Number.isSafeInteger(group.index) ||
				group.index < 0 ||
				group.index >= message.compiledInstructions.length ||
				innerGroups.has(group.index) ||
				!Array.isArray(group.instructions)
			)
				throw new Error("NFT transfer: malformed inner instruction group");
			innerGroups.add(group.index);
			for (const ix of group.instructions) {
				if (
					!validIndex(ix.programIdIndex, keys) ||
					!Array.isArray(ix.accounts) ||
					ix.accounts.some((index) => !validIndex(index, keys))
				)
					throw new Error(
						"NFT transfer: incomplete inner instruction accounts",
					);
				if (
					[TOKEN, TOKEN2022].includes(keys[ix.programIdIndex]) &&
					touched(ix.accounts)
				)
					throw new Error("NFT transfer: CPI NFT mutation is unsupported");
			}
		}
		const changed = new Set(),
			movedMints = new Set();
		for (const [
			instructionIndex,
			ix,
		] of message.compiledInstructions.entries()) {
			const accounts = ix.accountKeyIndexes;
			if (
				!validIndex(ix.programIdIndex, keys) ||
				!Array.isArray(accounts) ||
				accounts.some((index) => !validIndex(index, keys))
			)
				throw new Error("NFT transfer: incomplete outer instruction accounts");
			if (
				![TOKEN, TOKEN2022].includes(keys[ix.programIdIndex]) ||
				!touched(accounts)
			)
				continue;
			const data = Buffer.from(ix.data);
			const checked = data[0] === 12;
			if (
				keys[ix.programIdIndex] !== TOKEN ||
				![3, 12].includes(data[0]) ||
				data.length !== (checked ? 10 : 9) ||
				accounts.length !== (checked ? 4 : 3) ||
				data.readBigUInt64LE(1) !== 1n ||
				(checked && data[9] !== 0)
			)
				throw new Error("NFT transfer: unsupported NFT token instruction");
			const source = accounts[0],
				destination = accounts[checked ? 2 : 1],
				authority = accounts[checked ? 3 : 2];
			const beforeSource = pre.get(source),
				afterSource = post.get(source),
				beforeDestination = pre.get(destination),
				afterDestination = post.get(destination);
			if (
				source === destination ||
				!beforeSource ||
				!afterSource ||
				!beforeDestination ||
				!afterDestination ||
				beforeSource.amount !== "1" ||
				afterSource.amount !== "0" ||
				beforeDestination.amount !== "0" ||
				afterDestination.amount !== "1" ||
				[afterSource, beforeDestination, afterDestination].some(
					(b) => b.mint !== beforeSource.mint,
				) ||
				beforeSource.owner !== afterSource.owner ||
				beforeDestination.owner !== afterDestination.owner ||
				(checked && keys[accounts[1]] !== beforeSource.mint) ||
				keys[authority] !== beforeSource.owner ||
				!message.isAccountSigner(authority)
			)
				throw new Error(
					"NFT transfer: ownership/balance transition or signer is unverified",
				);
			if (movedMints.has(beforeSource.mint))
				throw new Error(
					"NFT transfer: multiple moves of one NFT are unsupported",
				);
			movedMints.add(beforeSource.mint);
			changed.add(source);
			changed.add(destination);
			const record = {
				network,
				finality,
				campaignId,
				programId,
				signature: transaction.signatures[0],
				instructionIndex,
				eventKind: "position_nft_transfer",
				transactionIndex: response.transactionIndex,
				slot,
				blockTimeSeconds,
				...byMint.get(beforeSource.mint),
				sourceTokenAccount: keys[source],
				destinationTokenAccount: keys[destination],
				fromOwnerWallet: beforeSource.owner,
				toOwnerWallet: beforeDestination.owner,
				amountRaw: "1",
				instructionKind: checked ? "transfer_checked" : "transfer",
			};
			const sourceKey = JSON.stringify([
				campaignId,
				network,
				record.signature,
				instructionIndex,
				record.positionMint,
			]);
			const evidenceSha256 = createHash("sha256")
				.update(JSON.stringify(record))
				.digest("hex");
			if (
				unique.has(sourceKey) &&
				unique.get(sourceKey).evidenceSha256 !== evidenceSha256
			)
				throw new Error("NFT transfer: conflicting source replay");
			unique.set(sourceKey, { sourceKey, evidenceSha256, record });
		}
		// Non-token instructions may read NFT accounts, but all remaining tracked
		// balances must be stable. Every token CPI touching them was refused above.
		for (const index of new Set([...pre.keys(), ...post.keys()])) {
			if (changed.has(index)) continue;
			const a = pre.get(index),
				b = post.get(index);
			if (
				!a ||
				!b ||
				a.mint !== b.mint ||
				a.owner !== b.owner ||
				a.amount !== b.amount
			)
				throw new Error("NFT transfer: unexplained NFT balance/owner change");
		}
		for (const mint of byMint.keys()) {
			const sum = (map) =>
				[...map.values()]
					.filter((b) => b.mint === mint)
					.reduce((total, b) => total + Number(b.amount), 0);
			if (sum(pre) > 1 || sum(post) > 1)
				throw new Error("NFT transfer: ambiguous multi-unit NFT evidence");
		}
	}
	return {
		state: "TEST_ONLY_POSITION_NFT_TRANSFERS",
		awardEligible: false,
		coverage: "PROVIDED_TRANSACTIONS_ONLY",
		network,
		campaignId,
		programId,
		slot,
		blockTimeSeconds,
		transfers: [...unique.values()].sort((a, b) =>
			a.sourceKey < b.sourceKey ? -1 : a.sourceKey > b.sourceKey ? 1 : 0,
		),
	};
}
