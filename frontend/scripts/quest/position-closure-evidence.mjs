import { createHash } from "node:crypto";
import { PublicKey } from "@solana/web3.js";
import bs58 from "bs58";

const TOKEN = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const CLOSE = createHash("sha256")
	.update("global:close_position")
	.digest()
	.subarray(0, 8);
const address = (value) => {
	if (typeof value !== "string" || new PublicKey(value).toBase58() !== value)
		throw new Error("Position closure: canonical address required");
	return value;
};
const validIndex = (index, keys) =>
	Number.isSafeInteger(index) && index >= 0 && index < keys.length;

/** Direct legacy Solve close with exact NFT burn/close CPI profile only. */
export function decodePositionClosureEvidence({
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
		throw new Error(
			"Position closure: bounded finalized Devnet input required",
		);
	address(programId);
	const positions = new Map(),
		mints = new Set(),
		knownTokens = new Set();
	for (const row of inventory) {
		const position = address(row?.positionAddress),
			mint = address(row.positionMint),
			token = address(row.tokenAccountAddress);
		const expected = PublicKey.findProgramAddressSync(
			[Buffer.from("position"), new PublicKey(mint).toBuffer()],
			new PublicKey(programId),
		)[0].toBase58();
		if (
			expected !== position ||
			positions.has(position) ||
			mints.has(mint) ||
			knownTokens.has(token)
		)
			throw new Error(
				"Position closure: invalid or duplicate position inventory",
			);
		positions.set(position, { positionAddress: position, positionMint: mint });
		mints.add(mint);
		knownTokens.add(token);
	}
	const unique = new Map(),
		blockIndices = new Map();
	for (const response of transactions) {
		const { transaction, meta } = response ?? {};
		if (
			!meta ||
			meta.err !== null ||
			response.slot !== slot ||
			response.blockTime !== blockTimeSeconds ||
			!Number.isSafeInteger(response.transactionIndex) ||
			response.transactionIndex < 0 ||
			typeof transaction?.signatures?.[0] !== "string" ||
			!transaction.signatures[0] ||
			!Array.isArray(meta.innerInstructions)
		)
			throw new Error(
				"Position closure: successful matching RPC context and complete inner metadata required",
			);
		if (
			blockIndices.has(response.transactionIndex) &&
			blockIndices.get(response.transactionIndex) !== transaction.signatures[0]
		)
			throw new Error("Position closure: conflicting block transaction index");
		blockIndices.set(response.transactionIndex, transaction.signatures[0]);
		const message = transaction.message;
		const lookups = message.addressTableLookups ?? [];
		for (const [kind, field] of [
			["writable", "writableIndexes"],
			["readonly", "readonlyIndexes"],
		]) {
			const expected = lookups.reduce(
				(sum, lookup) => sum + lookup[field].length,
				0,
			);
			if ((meta.loadedAddresses?.[kind]?.length ?? 0) !== expected)
				throw new Error("Position closure: complete loaded addresses required");
		}
		const keys = [
			...message.staticAccountKeys,
			...(meta.loadedAddresses?.writable ?? []),
			...(meta.loadedAddresses?.readonly ?? []),
		].map((key) => address(key.toBase58()));
		if (new Set(keys).size !== keys.length)
			throw new Error("Position closure: duplicate message accounts");
		if (
			!Array.isArray(meta.preBalances) ||
			!Array.isArray(meta.postBalances) ||
			meta.preBalances.length !== keys.length ||
			meta.postBalances.length !== keys.length ||
			[...meta.preBalances, ...meta.postBalances].some(
				(value) => !Number.isSafeInteger(value) || value < 0,
			)
		)
			throw new Error(
				"Position closure: complete exact lamport balances required",
			);
		const balances = (rows) => {
			if (!Array.isArray(rows))
				throw new Error("Position closure: complete token balances required");
			const seen = new Set(),
				map = new Map();
			for (const row of rows) {
				if (!validIndex(row.accountIndex, keys) || seen.has(row.accountIndex))
					throw new Error(
						"Position closure: invalid or duplicate token balance index",
					);
				seen.add(row.accountIndex);
				if (!mints.has(row.mint)) continue;
				if (
					row.programId !== TOKEN ||
					row.uiTokenAmount?.decimals !== 0 ||
					!["0", "1"].includes(row.uiTokenAmount.amount)
				)
					throw new Error(
						"Position closure: legacy NFT token balance required",
					);
				map.set(row.accountIndex, {
					mint: row.mint,
					owner: address(row.owner),
					amount: row.uiTokenAmount.amount,
				});
			}
			return map;
		};
		const pre = balances(meta.preTokenBalances),
			post = balances(meta.postTokenBalances);
		const tracked = new Set([...pre.keys(), ...post.keys()]);
		keys.forEach((key, index) => {
			if (positions.has(key) || mints.has(key) || knownTokens.has(key))
				tracked.add(index);
		});
		const groups = new Map();
		for (const group of meta.innerInstructions) {
			if (
				!Number.isSafeInteger(group.index) ||
				group.index < 0 ||
				group.index >= message.compiledInstructions.length ||
				groups.has(group.index) ||
				!Array.isArray(group.instructions)
			)
				throw new Error("Position closure: malformed inner instruction groups");
			for (const ix of group.instructions)
				if (
					!validIndex(ix.programIdIndex, keys) ||
					!Array.isArray(ix.accounts) ||
					ix.accounts.some((index) => !validIndex(index, keys))
				)
					throw new Error(
						"Position closure: incomplete inner instruction accounts",
					);
			groups.set(group.index, group.instructions);
		}
		const closedTokens = new Set(),
			closedPositions = new Set(),
			acceptedGroups = new Set();
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
				throw new Error(
					"Position closure: incomplete outer instruction accounts",
				);
			if (!accounts.some((index) => tracked.has(index))) continue;
			if (
				keys[ix.programIdIndex] !== programId ||
				!Buffer.from(ix.data).equals(CLOSE) ||
				accounts.length !== 6
			)
				throw new Error(
					"Position closure: unsupported selected-position instruction",
				);
			const [authority, receiver, position, mint, token, tokenProgram] =
				accounts;
			const selected = positions.get(keys[position]),
				before = pre.get(token),
				after = post.get(token);
			if (
				!selected ||
				selected.positionMint !== keys[mint] ||
				keys[tokenProgram] !== TOKEN ||
				new Set([position, mint, token, tokenProgram]).size !== 4 ||
				!message.isAccountSigner(authority) ||
				![receiver, position, mint, token].every((index) =>
					message.isAccountWritable(index),
				) ||
				!before ||
				before.mint !== keys[mint] ||
				before.owner !== keys[authority] ||
				before.amount !== "1" ||
				(after &&
					(after.mint !== before.mint ||
						after.owner !== before.owner ||
						after.amount !== "0")) ||
				meta.preBalances[position] === 0 ||
				meta.postBalances[position] !== 0 ||
				meta.preBalances[token] === 0 ||
				meta.postBalances[token] !== 0 ||
				closedTokens.has(token) ||
				closedPositions.has(position)
			)
				throw new Error(
					"Position closure: account identity, signer or terminal state unverified",
				);
			const inner = groups.get(instructionIndex);
			if (
				inner?.length !== 2 ||
				inner.some(
					(item) =>
						keys[item.programIdIndex] !== TOKEN || item.stackHeight !== 2,
				)
			)
				throw new Error(
					"Position closure: exact direct burn/close CPI profile required",
				);
			const burn = Buffer.from(bs58.decode(inner[0].data)),
				close = Buffer.from(bs58.decode(inner[1].data));
			const checked = burn[0] === 15;
			if (
				![8, 15].includes(burn[0]) ||
				burn.length !== (checked ? 10 : 9) ||
				burn.readBigUInt64LE(1) !== 1n ||
				(checked && burn[9] !== 0) ||
				JSON.stringify(inner[0].accounts) !==
					JSON.stringify([token, mint, authority]) ||
				close.length !== 1 ||
				close[0] !== 9 ||
				JSON.stringify(inner[1].accounts) !==
					JSON.stringify([token, receiver, authority])
			)
				throw new Error(
					"Position closure: NFT burn/close instructions differ from closure accounts",
				);
			closedTokens.add(token);
			closedPositions.add(position);
			acceptedGroups.add(instructionIndex);
			const record = {
				network,
				finality,
				campaignId,
				programId,
				signature: transaction.signatures[0],
				transactionIndex: response.transactionIndex,
				instructionIndex,
				eventKind: "position_close_observed",
				slot,
				blockTimeSeconds,
				...selected,
				tokenAccountAddress: keys[token],
				observedOwnerWallet: keys[authority],
				receiver: keys[receiver],
				burnAmountRaw: "1",
				instructionKind: "close_position",
				burnInstructionKind: checked ? "burn_checked" : "burn",
			};
			const sourceKey = JSON.stringify([
				campaignId,
				network,
				record.signature,
				instructionIndex,
				record.positionMint,
				"position_close",
			]);
			const evidenceSha256 = createHash("sha256")
				.update(JSON.stringify(record))
				.digest("hex");
			if (
				unique.has(sourceKey) &&
				unique.get(sourceKey).evidenceSha256 !== evidenceSha256
			)
				throw new Error("Position closure: conflicting source replay");
			unique.set(sourceKey, { sourceKey, evidenceSha256, record });
		}
		for (const [index, inner] of groups)
			if (
				!acceptedGroups.has(index) &&
				inner.some((ix) => ix.accounts.some((account) => tracked.has(account)))
			)
				throw new Error("Position closure: unsupported tracked-position CPI");
		for (const index of new Set([...pre.keys(), ...post.keys()])) {
			if (closedTokens.has(index)) continue;
			const a = pre.get(index),
				b = post.get(index);
			if (
				!a ||
				!b ||
				a.mint !== b.mint ||
				a.owner !== b.owner ||
				a.amount !== b.amount
			)
				throw new Error("Position closure: unexplained NFT state change");
		}
		for (const map of [pre, post]) {
			const totals = new Map();
			for (const balance of map.values()) {
				const sum = (totals.get(balance.mint) ?? 0) + Number(balance.amount);
				totals.set(balance.mint, sum);
				if (sum > 1)
					throw new Error(
						"Position closure: ambiguous multi-unit NFT evidence",
					);
			}
		}
	}
	return {
		state: "TEST_ONLY_POSITION_CLOSURES",
		awardEligible: false,
		coverage: "PROVIDED_TRANSACTIONS_ONLY",
		network,
		campaignId,
		programId,
		slot,
		blockTimeSeconds,
		closures: [...unique.values()].sort((a, b) =>
			a.sourceKey < b.sourceKey ? -1 : a.sourceKey > b.sourceKey ? 1 : 0,
		),
	};
}
