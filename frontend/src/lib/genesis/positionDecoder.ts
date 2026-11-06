import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import type {
	TokenBalance,
	VersionedTransactionResponse,
} from "@solana/web3.js";
import type { GenesisChainEventRecord } from "./eventFingerprint";
import { decodePositionEvent } from "./liquidityEvent.ts";
import { collectDirectProgramData } from "./programLogs.ts";
import { classifySolveInstruction } from "./solveInstructionKind.ts";

type RpcTokenBalance = TokenBalance & { programId?: string };

const TOKEN_PROGRAMS = new Set([
	TOKEN_PROGRAM_ID.toBase58(),
	TOKEN_2022_PROGRAM_ID.toBase58(),
]);

function assertNoNftTokenInstruction(
	message: VersionedTransactionResponse["transaction"]["message"],
	meta: NonNullable<VersionedTransactionResponse["meta"]>,
	keys: readonly string[],
	nftIndex: number,
) {
	for (const ix of message.compiledInstructions) {
		if (
			TOKEN_PROGRAMS.has(keys[ix.programIdIndex]) &&
			ix.accountKeyIndexes.includes(nftIndex)
		) {
			throw new Error("Position NFT changed within transaction.");
		}
	}
	if (!meta.innerInstructions)
		throw new Error("Position NFT inner instructions are unavailable.");
	for (const group of meta.innerInstructions) {
		for (const ix of group.instructions) {
			if (
				TOKEN_PROGRAMS.has(keys[ix.programIdIndex]) &&
				ix.accounts.includes(nftIndex)
			) {
				throw new Error("Position NFT changed within transaction.");
			}
		}
	}
}

function oneBalance(
	balances: readonly TokenBalance[] | null | undefined,
	accountIndex: number,
): RpcTokenBalance | undefined {
	const matches =
		balances?.filter((balance) => balance.accountIndex === accountIndex) ?? [];
	if (matches.length > 1) throw new Error("Repeated position token balance.");
	return matches[0];
}

function checkNft(
	balance: RpcTokenBalance | undefined,
	owner: string,
	mint?: string,
	tokenProgram?: string,
) {
	if (
		!balance ||
		balance.owner !== owner ||
		balance.uiTokenAmount.amount !== "1" ||
		balance.uiTokenAmount.decimals !== 0 ||
		(mint !== undefined && balance.mint !== mint) ||
		!balance.programId ||
		!TOKEN_PROGRAMS.has(balance.programId) ||
		(tokenProgram !== undefined && balance.programId !== tokenProgram)
	) {
		throw new Error("Position NFT ownership is unverified.");
	}
	return balance.mint;
}

type PositionDecoderInput = {
	campaignId: string;
	cluster: GenesisChainEventRecord["cluster"];
	programId: string;
	slot: number;
	blockTimeSeconds: number;
	transactions: readonly VersionedTransactionResponse[];
};

/** Direct position open and liquidity changes; no XP or ownership timeline. */
export function decodeVerifiedPositionTransactions(
	input: PositionDecoderInput,
): GenesisChainEventRecord[] {
	return decodePositionTransactions(input, false);
}

/** Only the combined decoder may omit recognized swap instructions. */
export function decodePositionTransactionsWithSwaps(
	input: PositionDecoderInput,
): GenesisChainEventRecord[] {
	return decodePositionTransactions(input, true);
}

function decodePositionTransactions(
	input: PositionDecoderInput,
	withSwaps: boolean,
): GenesisChainEventRecord[] {
	const records: GenesisChainEventRecord[] = [];
	for (const response of input.transactions) {
		const { transaction, meta } = response;
		if (!meta || meta.err !== null)
			throw new Error("Position decoder requires a successful transaction.");
		const message = transaction.message;
		const keys = [
			...message.staticAccountKeys,
			...(meta.loadedAddresses?.writable ?? []),
			...(meta.loadedAddresses?.readonly ?? []),
		].map((key) => key.toBase58());
		const instructions = message.compiledInstructions;
		const programIds = instructions.map((ix) => keys[ix.programIdIndex]);
		if (!programIds.includes(input.programId)) {
			if (
				meta.innerInstructions?.some((group) =>
					group.instructions.some(
						(ix) => keys[ix.programIdIndex] === input.programId,
					),
				) ||
				meta.logMessages?.some((log) =>
					log.startsWith(`Program ${input.programId} invoke [`),
				)
			) {
				throw new Error("Solve CPI position attribution is unsupported.");
			}
			continue;
		}
		const signature = transaction.signatures[0];
		if (!signature) throw new Error("Position transaction has no signature.");
		const eventData = collectDirectProgramData(
			meta.logMessages,
			programIds,
			input.programId,
		);
		const opened = new Map<
			number,
			{ owner: string; position: string; mint: string; tokenProgram: string }
		>();
		for (
			let instructionIndex = 0;
			instructionIndex < instructions.length;
			instructionIndex++
		) {
			const ix = instructions[instructionIndex];
			if (programIds[instructionIndex] !== input.programId) continue;
			const classified = classifySolveInstruction(ix.data);
			if (!classified || (classified.family === "swap" && !withSwaps))
				throw new Error("Unsupported Solve instruction in position decoder.");
			if (classified.family === "swap") continue;
			const kind = classified.kind;
			const account = (position: number) => {
				const index = ix.accountKeyIndexes[position];
				const key = keys[index];
				if (index === undefined || !key)
					throw new Error("Position instruction account is missing.");
				return { index, key };
			};
			const payloads = eventData.get(instructionIndex) ?? [];
			if (
				kind === "initialize_dynamic_tick_array" ||
				kind === "initialize_tick_array"
			) {
				if (payloads.length)
					throw new Error("Unexpected event in tick-array initialization.");
				continue;
			}
			if (payloads.length !== 1)
				throw new Error("Position instruction event count mismatch.");
			const event = decodePositionEvent(payloads[0]);
			let wallet: string;
			if (
				kind === "open_position" ||
				kind === "open_position_with_metadata" ||
				kind === "open_position_with_token_extensions"
			) {
				if (event.kind !== "position_open")
					throw new Error("Position event kind mismatch.");
				const funder = account(0);
				const owner = account(1);
				const position = account(2);
				const mint = account(3);
				const nft = account(kind === "open_position_with_metadata" ? 5 : 4);
				const pool = account(kind === "open_position_with_metadata" ? 6 : 5);
				const tokenProgram =
					kind === "open_position_with_token_extensions"
						? TOKEN_2022_PROGRAM_ID.toBase58()
						: TOKEN_PROGRAM_ID.toBase58();
				if (
					!message.isAccountSigner(funder.index) ||
					position.key !== event.positionAddress ||
					pool.key !== event.poolAddress
				) {
					throw new Error("Position-open accounts do not match event.");
				}
				if (oneBalance(meta.preTokenBalances, nft.index))
					throw new Error("Position NFT existed before open.");
				checkNft(
					oneBalance(meta.postTokenBalances, nft.index),
					owner.key,
					mint.key,
					tokenProgram,
				);
				opened.set(nft.index, {
					owner: owner.key,
					position: position.key,
					mint: mint.key,
					tokenProgram,
				});
				wallet = owner.key;
			} else {
				const expected =
					kind === "increase_liquidity" || kind === "increase_liquidity_v2"
						? "liquidity_increase"
						: "liquidity_decrease";
				if (event.kind !== expected)
					throw new Error("Liquidity event kind mismatch.");
				const pool = account(0);
				const v2 =
					kind === "increase_liquidity_v2" || kind === "decrease_liquidity_v2";
				const authority = account(v2 ? 4 : 2);
				const position = account(v2 ? 5 : 3);
				const nft = account(v2 ? 6 : 4);
				if (
					!message.isAccountSigner(authority.index) ||
					pool.key !== event.poolAddress ||
					position.key !== event.positionAddress
				) {
					throw new Error("Liquidity accounts do not match event.");
				}
				const previous = oneBalance(meta.preTokenBalances, nft.index);
				const after = oneBalance(meta.postTokenBalances, nft.index);
				const newPosition = opened.get(nft.index);
				if (
					newPosition &&
					(newPosition.owner !== authority.key ||
						newPosition.position !== position.key)
				)
					throw new Error("Position owner changed within transaction.");
				if (!previous && !newPosition)
					throw new Error("Position NFT prior owner is unavailable.");
				const mint = checkNft(
					after,
					authority.key,
					newPosition?.mint,
					newPosition?.tokenProgram,
				);
				if (previous) {
					checkNft(previous, authority.key, mint, after?.programId);
					assertNoNftTokenInstruction(message, meta, keys, nft.index);
				}
				wallet = authority.key;
			}
			records.push({
				campaignId: input.campaignId,
				cluster: input.cluster,
				signature,
				instructionIndex,
				eventIndex: 0,
				eventKind: event.kind,
				slot: input.slot,
				blockTimeSeconds: input.blockTimeSeconds,
				wallet,
				poolAddress: event.poolAddress,
				positionAddress: event.positionAddress,
				payload: { instructionKind: kind, ...event },
			});
		}
	}
	return records;
}
