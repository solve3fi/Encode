import { createHash } from "node:crypto";
import { PublicKey } from "@solana/web3.js";

const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const POSITION_DISCRIMINATOR = createHash("sha256")
	.update("account:Position")
	.digest()
	.subarray(0, 8);

/** Caller must supply the startup-verified Devnet connection. No default RPC. */
export function createPositionBaselineReader({
	connection,
	network,
	programId,
	layoutVersion,
}) {
	key(programId);
	if (
		network !== "DEVNET" ||
		layoutVersion !== "solve-position-v1" ||
		typeof connection?.getMultipleAccountsInfoAndContext !== "function"
	)
		throw new Error(
			"Position baseline: verified Devnet reader configuration required",
		);
	return {
		async read({
			positionAddress,
			positionMint,
			tokenAccountAddress,
			minContextSlot,
		}) {
			if (!Number.isSafeInteger(minContextSlot) || minContextSlot < 0)
				throw new Error("Position baseline: minimum context slot required");
			const addresses = [positionAddress, positionMint, tokenAccountAddress];
			const keys = addresses.map(key);
			if (new Set(addresses).size !== 3)
				throw new Error("Position baseline: repeated account address");
			// One context-bearing RPC response prevents combining accounts from
			// separate reads. minContextSlot is a lower bound, not a historical query.
			const response = await connection.getMultipleAccountsInfoAndContext(
				keys,
				{ commitment: "finalized", minContextSlot },
			);
			if (
				!Number.isSafeInteger(response?.context?.slot) ||
				response.context.slot < minContextSlot ||
				!Array.isArray(response.value) ||
				response.value.length !== 3
			)
				throw new Error("Position baseline: incomplete or stale RPC snapshot");
			const accounts = response.value.map((info, index) => {
				if (!info || !Buffer.isBuffer(info.data) || info.data.length > 216)
					throw new Error(
						"Position baseline: missing or unsupported raw account data",
					);
				return {
					address: addresses[index],
					owner: info.owner.toBase58(),
					executable: info.executable,
					dataBase64: info.data.toString("base64"),
				};
			});
			return projectPositionBaselineEvidence({
				network,
				finality: "finalized",
				slot: response.context.slot,
				programId,
				layoutVersion,
				positionAccount: accounts[0],
				mintAccount: accounts[1],
				tokenAccount: accounts[2],
			});
		},
	};
}

function key(value) {
	if (typeof value !== "string")
		throw new TypeError("Position baseline: address required");
	const parsed = new PublicKey(value);
	if (parsed.toBase58() !== value)
		throw new TypeError("Position baseline: canonical address required");
	return parsed;
}

function account(value, owner, bytes) {
	key(value?.address);
	if (
		value.owner !== owner ||
		value.executable !== false ||
		typeof value.dataBase64 !== "string" ||
		value.dataBase64.length > 400
	)
		throw new Error(
			"Position baseline: wrong owner, executable flag or account encoding",
		);
	const data = Buffer.from(value.dataBase64, "base64");
	if (data.length !== bytes || data.toString("base64") !== value.dataBase64)
		throw new Error(
			"Position baseline: unsupported account size or noncanonical base64",
		);
	return data;
}

/**
 * Pure point-in-time validator for one caller-supplied finalized multi-account
 * snapshot. No RPC, historical completeness claim, valuation or award writer.
 * Layout: @solve3fi/sdk 0.3.1 Position plus legacy SPL Mint/Account only.
 */
export function projectPositionBaselineEvidence({
	network,
	finality,
	slot,
	programId,
	layoutVersion,
	positionAccount,
	mintAccount,
	tokenAccount,
}) {
	if (
		network !== "DEVNET" ||
		finality !== "finalized" ||
		layoutVersion !== "solve-position-v1" ||
		!Number.isSafeInteger(slot) ||
		slot < 0
	)
		throw new Error(
			"Position baseline: pinned finalized Devnet snapshot required",
		);
	const program = key(programId);
	const position = account(positionAccount, programId, 216);
	if (!position.subarray(0, 8).equals(POSITION_DISCRIMINATOR))
		throw new Error("Position baseline: unsupported position discriminator");
	const poolAddress = new PublicKey(position.subarray(8, 40)).toBase58();
	const positionMint = new PublicKey(position.subarray(40, 72));
	const [expectedPosition] = PublicKey.findProgramAddressSync(
		[Buffer.from("position"), positionMint.toBuffer()],
		program,
	);
	if (expectedPosition.toBase58() !== positionAccount.address)
		throw new Error(
			"Position baseline: position PDA differs from mint/program",
		);
	const tickLowerIndex = position.readInt32LE(88);
	const tickUpperIndex = position.readInt32LE(92);
	if (tickLowerIndex >= tickUpperIndex)
		throw new Error("Position baseline: invalid position ticks");
	const mint = account(mintAccount, TOKEN_PROGRAM, 82);
	const token = account(tokenAccount, TOKEN_PROGRAM, 165);
	if (
		mintAccount.address !== positionMint.toBase58() ||
		!token.subarray(0, 32).equals(positionMint.toBuffer())
	)
		throw new Error("Position baseline: NFT mint differs across accounts");
	if (
		mint.readBigUInt64LE(36) !== 1n ||
		mint[44] !== 0 ||
		mint[45] !== 1 ||
		![0, 1].includes(mint.readUInt32LE(0)) ||
		![0, 1].includes(mint.readUInt32LE(46))
	)
		throw new Error(
			"Position baseline: initialized one-unit NFT mint required",
		);
	// Conservative supported ownership shape: initialized, unfrozen, no delegate,
	// no native wrapping or close authority. Other shapes need a reviewed adapter.
	if (
		token.readBigUInt64LE(64) !== 1n ||
		token[108] !== 1 ||
		token.readUInt32LE(72) !== 0 ||
		token.readUInt32LE(109) !== 0 ||
		token.readBigUInt64LE(121) !== 0n ||
		token.readUInt32LE(129) !== 0
	)
		throw new Error("Position baseline: unsupported NFT ownership account");
	const observedOwnerWallet = new PublicKey(token.subarray(32, 64)).toBase58();
	const addresses = [
		positionAccount.address,
		mintAccount.address,
		tokenAccount.address,
	];
	if (new Set(addresses).size !== 3)
		throw new Error("Position baseline: repeated account address");
	// Hash raw bytes and context, including fields not used for metrics. Equality
	// binds this observation; it cannot authenticate the RPC provider or finality.
	const evidenceSha256 = createHash("sha256")
		.update(
			JSON.stringify({
				network,
				finality,
				slot,
				programId,
				layoutVersion,
				accounts: [positionAccount, mintAccount, tokenAccount].map((a) => ({
					address: a.address,
					owner: a.owner,
					executable: a.executable,
					dataBase64: a.dataBase64,
				})),
			}),
		)
		.digest("hex");
	return {
		state: "TEST_ONLY_POSITION_BASELINE",
		awardEligible: false,
		ownershipCoverage: "POINT_IN_TIME",
		network,
		finality,
		slot,
		programId,
		layoutVersion,
		positionAddress: positionAccount.address,
		poolAddress,
		positionMint: positionMint.toBase58(),
		tokenAccountAddress: tokenAccount.address,
		observedOwnerWallet,
		tickLowerIndex,
		tickUpperIndex,
		liquidityRaw: (
			position.readBigUInt64LE(72) +
			(position.readBigUInt64LE(80) << 64n)
		).toString(),
		evidenceSha256,
	};
}
