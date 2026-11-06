import { PublicKey, type VersionedTransactionResponse } from "@solana/web3.js";
import bs58 from "bs58";
import type { GenesisChainEventRecord } from "./eventFingerprint";
import { collectDirectProgramData } from "./programLogs.ts";
import {
	classifySolveInstruction,
	type SwapKind,
} from "./solveInstructionKind.ts";
import { decodeTradedEvent } from "./tradedEvent.ts";

type Hop = { pool: number; inputVault: number; outputVault: number };
type Layout = {
	authority: number;
	pools: readonly number[];
	ownerAccounts: readonly number[];
	/** Instruction-data offset of the first hop's `a_to_b` byte. */
	directionOffset: number;
	/** Pool and vault account positions of each hop, given each hop's direction. */
	hops: (aToB: readonly boolean[]) => readonly Hop[];
	/** The signer's token accounts the first input leaves and the last output enters. */
	userAccounts: (aToB: readonly boolean[]) => { input: number; output: number };
};
// Account positions follow the Solve program's instruction accounts (the Apache build keeps the
// same order as the earlier build; `solves_config` is always last and is never decoded).
const LAYOUTS: Record<SwapKind, Layout> = {
	swap: {
		authority: 1,
		pools: [2],
		ownerAccounts: [3, 5],
		directionOffset: 41,
		hops: ([a]) => [{ pool: 2, inputVault: a ? 4 : 6, outputVault: a ? 6 : 4 }],
		userAccounts: ([a]) => ({ input: a ? 3 : 5, output: a ? 5 : 3 }),
	},
	two_hop_swap: {
		authority: 1,
		pools: [2, 3],
		ownerAccounts: [],
		directionOffset: 25,
		hops: ([a, b]) => [
			{ pool: 2, inputVault: a ? 5 : 7, outputVault: a ? 7 : 5 },
			{ pool: 3, inputVault: b ? 9 : 11, outputVault: b ? 11 : 9 },
		],
		userAccounts: ([a, b]) => ({ input: a ? 4 : 6, output: b ? 10 : 8 }),
	},
	swap_v2: {
		authority: 3,
		pools: [4],
		ownerAccounts: [7, 9],
		directionOffset: 41,
		hops: ([a]) => [{ pool: 4, inputVault: a ? 8 : 10, outputVault: a ? 10 : 8 }],
		userAccounts: ([a]) => ({ input: a ? 7 : 9, output: a ? 9 : 7 }),
	},
	two_hop_swap_v2: {
		authority: 14,
		pools: [0, 1],
		ownerAccounts: [8, 13],
		directionOffset: 25,
		hops: () => [
			{ pool: 0, inputVault: 9, outputVault: 10 },
			{ pool: 1, inputVault: 11, outputVault: 12 },
		],
		userAccounts: () => ({ input: 8, output: 13 }),
	},
};

type TokenTransfer = {
	source: string;
	destination: string;
	authority: string;
	amount: bigint;
};

/**
 * Every inner instruction of one outer Solve swap must be a classic SPL Token Transfer or
 * TransferChecked. Anything else (Token-2022 fees or hooks, memo, nested programs) is refused.
 */
function innerTokenTransfers(
	meta: NonNullable<VersionedTransactionResponse["meta"]>,
	keys: readonly string[],
	instructionIndex: number,
): TokenTransfer[] {
	if (!meta.innerInstructions)
		throw new Error("Swap inner instructions are unavailable.");
	const groups = meta.innerInstructions.filter(
		(group) => group.index === instructionIndex,
	);
	if (groups.length > 1) throw new Error("Swap inner instructions are repeated.");
	const transfers: TokenTransfer[] = [];
	for (const ix of groups[0]?.instructions ?? []) {
		if (keys[ix.programIdIndex] !== TOKEN_PROGRAM)
			throw new Error("Unsupported inner instruction in swap.");
		const data = Buffer.from(bs58.decode(ix.data));
		const account = (position: number) => {
			const key = keys[ix.accounts[position]];
			if (!key) throw new Error("Swap token transfer account is missing.");
			return key;
		};
		if (data[0] === 3 && data.length === 9) {
			transfers.push({
				source: account(0),
				destination: account(1),
				authority: account(2),
				amount: data.readBigUInt64LE(1),
			});
		} else if (data[0] === 12 && data.length === 10) {
			transfers.push({
				source: account(0),
				destination: account(2),
				authority: account(3),
				amount: data.readBigUInt64LE(1),
			});
		} else {
			throw new Error("Unsupported token instruction in swap.");
		}
	}
	return transfers;
}

/**
 * Trades for an Apache-build swap, which emits no events: the exact SPL transfers the program
 * performed, matched to the instruction's vault and user accounts. Fees and prices are not
 * recoverable from a transaction and are not reported.
 */
function derivedTrades(input: {
	layout: Layout;
	data: Buffer;
	instructionIndex: number;
	meta: NonNullable<VersionedTransactionResponse["meta"]>;
	keys: readonly string[];
	account: (position: number) => { key: string; keyIndex: number };
	authorityKey: string;
}) {
	const { layout, data, instructionIndex, meta, keys, account, authorityKey } =
		input;
	const aToB = layout.pools.map((_, hop) => {
		const direction = data[layout.directionOffset + hop];
		if (direction !== 0 && direction !== 1)
			throw new Error("Swap instruction direction is missing or invalid.");
		return direction === 1;
	});
	const hops = layout.hops(aToB);
	const user = layout.userAccounts(aToB);
	const transfers = innerTokenTransfers(meta, keys, instructionIndex);
	const used = new Set<TokenTransfer>();
	const exactlyOne = (match: (transfer: TokenTransfer) => boolean) => {
		const found = transfers.filter(match);
		if (found.length !== 1)
			throw new Error("Swap token transfers are ambiguous or missing.");
		used.add(found[0]);
		return found[0];
	};
	const legs = hops.map((hop) => {
		const inputVault = account(hop.inputVault).key;
		const outputVault = account(hop.outputVault).key;
		return {
			pool: account(hop.pool).key,
			inputVault,
			outputVault,
			into: exactlyOne((t) => t.destination === inputVault),
			out: exactlyOne((t) => t.source === outputVault),
		};
	});
	if (used.size !== transfers.length)
		throw new Error("Unexpected token transfer in swap.");
	legs.forEach((leg, index) => {
		if (leg.into.amount <= BigInt(0) || leg.out.amount <= BigInt(0))
			throw new Error("Swap transfer amount must be positive.");
		if (leg.out.authority !== leg.pool)
			throw new Error("Swap output transfer is not authorized by the pool.");
		const previous = legs[index - 1];
		if (!previous) {
			if (
				leg.into.source !== account(user.input).key ||
				leg.into.authority !== authorityKey
			)
				throw new Error("Swap input transfer does not match the instruction.");
		} else if (previous.out === leg.into) {
			// vault-to-vault intermediate transfer: authorized by the previous pool, checked above
		} else if (
			previous.out.destination !== leg.into.source ||
			previous.out.amount !== leg.into.amount ||
			leg.into.authority !== authorityKey
		) {
			throw new Error("Swap intermediate transfers do not match.");
		}
		if (
			index === legs.length - 1 &&
			leg.out.destination !== account(user.output).key
		)
			throw new Error("Swap output transfer does not match the instruction.");
	});
	return legs.map((leg, index) => ({
		poolAddress: leg.pool,
		aToB: aToB[index],
		inputAmountRaw: leg.into.amount.toString(),
		outputAmountRaw: leg.out.amount.toString(),
		inputVaultAddress: leg.inputVault,
		outputVaultAddress: leg.outputVault,
	}));
}
const SYSTEM_PROGRAM = "11111111111111111111111111111111";
const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const WRAPPED_SOL_MINT = "So11111111111111111111111111111111111111112";

function verifiedTransientWrappedSolOwner(input: {
	accountIndex: number;
	authorityIndex: number;
	swapInstructionIndex: number;
	message: VersionedTransactionResponse["transaction"]["message"];
	meta: NonNullable<VersionedTransactionResponse["meta"]>;
	keys: readonly string[];
}): string {
	const {
		accountIndex,
		authorityIndex,
		swapInstructionIndex,
		message,
		meta,
		keys,
	} = input;
	if (!meta.innerInstructions) {
		throw new Error(
			"Transient SOL account inner instructions are unavailable.",
		);
	}
	const instructions = message.compiledInstructions;
	const changesOwner = (
		program: string | undefined,
		data: Uint8Array,
		target: number | undefined,
	) => program === TOKEN_PROGRAM && data[0] === 6 && target === accountIndex;
	let created = false;
	let initialized = false;
	let closed = false;
	for (let i = 0; i < instructions.length; i++) {
		const ix = instructions[i];
		const program = keys[ix.programIdIndex];
		const data = Buffer.from(ix.data);
		if (changesOwner(program, data, ix.accountKeyIndexes[0])) {
			throw new Error("Transient SOL account authority changed.");
		}
		if (
			i < swapInstructionIndex &&
			program === SYSTEM_PROGRAM &&
			ix.accountKeyIndexes[1] === accountIndex &&
			data.length === 52 &&
			data.readUInt32LE(0) === 0 &&
			data.readBigUInt64LE(12) === BigInt(165) &&
			new PublicKey(data.subarray(20, 52)).toBase58() === TOKEN_PROGRAM
		) {
			if (created || ix.accountKeyIndexes[0] !== authorityIndex)
				throw new Error("Transient SOL account creation is ambiguous.");
			created = true;
		}
		if (
			i < swapInstructionIndex &&
			program === TOKEN_PROGRAM &&
			ix.accountKeyIndexes[0] === accountIndex &&
			data.length === 1 &&
			data[0] === 1
		) {
			if (
				initialized ||
				!created ||
				keys[ix.accountKeyIndexes[1]] !== WRAPPED_SOL_MINT ||
				ix.accountKeyIndexes[2] !== authorityIndex
			) {
				throw new Error("Transient SOL account initialization is ambiguous.");
			}
			initialized = true;
		}
		if (
			i > swapInstructionIndex &&
			program === TOKEN_PROGRAM &&
			ix.accountKeyIndexes[0] === accountIndex &&
			data.length === 1 &&
			data[0] === 9
		) {
			if (
				closed ||
				ix.accountKeyIndexes[1] !== authorityIndex ||
				ix.accountKeyIndexes[2] !== authorityIndex
			) {
				throw new Error("Transient SOL account close is ambiguous.");
			}
			closed = true;
		}
	}
	for (const group of meta.innerInstructions) {
		for (const ix of group.instructions) {
			if (
				changesOwner(
					keys[ix.programIdIndex],
					bs58.decode(ix.data),
					ix.accounts[0],
				)
			) {
				throw new Error("Transient SOL account authority changed in a CPI.");
			}
		}
	}
	if (
		!created ||
		!initialized ||
		!closed ||
		!message.isAccountSigner(accountIndex)
	) {
		throw new Error("Transient SOL account ownership is unverified.");
	}
	return keys[authorityIndex];
}

function verifiedOwner(
	accountIndex: number,
	meta: NonNullable<VersionedTransactionResponse["meta"]>,
	transient: Parameters<typeof verifiedTransientWrappedSolOwner>[0],
): string {
	const owners = [meta.preTokenBalances, meta.postTokenBalances]
		.flatMap((balances) => balances ?? [])
		.filter((balance) => balance.accountIndex === accountIndex)
		.map((balance) => balance.owner);
	if (owners.length === 0) return verifiedTransientWrappedSolOwner(transient);
	if (owners.some((owner) => !owner || owner !== owners[0])) {
		throw new Error("Swap token-account owner is unavailable or inconsistent.");
	}
	return owners[0] as string;
}

type SwapDecoderInput = {
	campaignId: string;
	cluster: GenesisChainEventRecord["cluster"];
	programId: string;
	slot: number;
	blockTimeSeconds: number;
	transactions: readonly VersionedTransactionResponse[];
};

/** Direct Solve swap instructions only. Unsupported Solve instructions halt indexing. */
export function decodeVerifiedSwapTransactions(
	input: SwapDecoderInput,
): GenesisChainEventRecord[] {
	return decodeSwapTransactions(input, false);
}

/** Only the combined decoder may omit recognized position instructions. */
export function decodeSwapTransactionsWithPositions(
	input: SwapDecoderInput,
): GenesisChainEventRecord[] {
	return decodeSwapTransactions(input, true);
}

function decodeSwapTransactions(
	input: SwapDecoderInput,
	withPositions: boolean,
): GenesisChainEventRecord[] {
	const records: GenesisChainEventRecord[] = [];
	for (const response of input.transactions) {
		const { transaction, meta } = response;
		if (!meta || meta.err !== null)
			throw new Error("Swap decoder requires a successful transaction.");
		const message = transaction.message;
		const keys = [
			...message.staticAccountKeys,
			...(meta.loadedAddresses?.writable ?? []),
			...(meta.loadedAddresses?.readonly ?? []),
		].map((key) => key.toBase58());
		const instructions = message.compiledInstructions;
		const relevant = instructions.some(
			(ix) => keys[ix.programIdIndex] === input.programId,
		);
		if (!relevant) {
			const cpiInstruction = meta.innerInstructions?.some((group) =>
				group.instructions.some(
					(ix) => keys[ix.programIdIndex] === input.programId,
				),
			);
			const cpiLog = meta.logMessages?.some((log) =>
				log.startsWith(`Program ${input.programId} invoke [`),
			);
			if (cpiInstruction || cpiLog)
				throw new Error("Solve CPI attribution is unsupported.");
			continue;
		}
		const signature = transaction.signatures[0];
		if (!signature) throw new Error("Solve transaction has no signature.");
		const events = collectDirectProgramData(
			meta.logMessages,
			instructions.map((ix) => keys[ix.programIdIndex]),
			input.programId,
		);
		for (
			let instructionIndex = 0;
			instructionIndex < instructions.length;
			instructionIndex++
		) {
			const ix = instructions[instructionIndex];
			if (keys[ix.programIdIndex] !== input.programId) continue;
			const data = Buffer.from(ix.data);
			const classified = classifySolveInstruction(data);
			if (!classified || (classified.family === "position" && !withPositions))
				throw new Error("Unsupported Solve instruction in swap decoder.");
			if (classified.family === "position") continue;
			const kind = classified.kind;
			const layout = LAYOUTS[kind];
			const account = (position: number) => {
				const keyIndex = ix.accountKeyIndexes[position];
				const key = keys[keyIndex];
				if (keyIndex === undefined || !key)
					throw new Error("Swap instruction account is missing.");
				return { key, keyIndex };
			};
			const authority = account(layout.authority);
			if (!message.isAccountSigner(authority.keyIndex)) {
				throw new Error("Swap authority is not a transaction signer.");
			}
			const eventData = events.get(instructionIndex) ?? [];
			// Earlier builds emitted a `Traded` event per hop; the Apache build emits none,
			// so its trades come from the exact token transfers instead.
			let trades: ReadonlyArray<
					{ poolAddress: string; aToB: boolean } & Record<string, string | boolean>
				>;
			if (eventData.length === 0) {
				trades = derivedTrades({
					layout,
					data,
					instructionIndex,
					meta,
					keys,
					account,
					authorityKey: authority.key,
				});
			} else {
				if (eventData.length !== layout.pools.length) {
					throw new Error("Swap trade event count does not match instruction.");
				}
				const decoded = eventData.map(decodeTradedEvent);
				for (let eventIndex = 0; eventIndex < decoded.length; eventIndex++) {
					const direction = data[layout.directionOffset + eventIndex];
					if (direction !== 0 && direction !== 1) {
						throw new Error("Swap instruction direction is missing or invalid.");
					}
					if (decoded[eventIndex].aToB !== (direction === 1)) {
						throw new Error("Trade event direction does not match instruction.");
					}
				}
				trades = decoded;
			}
			const ownerPositions = layout.ownerAccounts.length
				? layout.ownerAccounts
				: Object.values(layout.userAccounts(trades.map((t) => t.aToB)));
			for (const position of ownerPositions) {
				const ownerAccount = account(position);
				if (
					verifiedOwner(ownerAccount.keyIndex, meta, {
						accountIndex: ownerAccount.keyIndex,
						authorityIndex: authority.keyIndex,
						swapInstructionIndex: instructionIndex,
						message,
						meta,
						keys,
					}) !== authority.key
				) {
					throw new Error(
						"Delegated or third-party swap account is unsupported.",
					);
				}
			}
			for (let eventIndex = 0; eventIndex < trades.length; eventIndex++) {
				const traded = trades[eventIndex];
				if (traded.poolAddress !== account(layout.pools[eventIndex]).key) {
					throw new Error("Trade event pool does not match instruction.");
				}
				records.push({
					campaignId: input.campaignId,
					cluster: input.cluster,
					signature,
					instructionIndex,
					eventIndex,
					eventKind: "swap",
					slot: input.slot,
					blockTimeSeconds: input.blockTimeSeconds,
					wallet: authority.key,
					poolAddress: traded.poolAddress,
					positionAddress: null,
					payload: { instructionKind: kind, ...traded },
				});
			}
		}
	}
	return records;
}
