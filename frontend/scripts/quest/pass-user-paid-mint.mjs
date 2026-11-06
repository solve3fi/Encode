import { createHmac } from "node:crypto";
import {
	ASSOCIATED_TOKEN_PROGRAM_ID,
	AuthorityType,
	createAssociatedTokenAccountIdempotentInstruction,
	createInitializeInstruction,
	createInitializeMetadataPointerInstruction,
	createInitializeMintInstruction,
	createInitializeNonTransferableMintInstruction,
	createMintToCheckedInstruction,
	createSetAuthorityInstruction,
	ExtensionType,
	getAccountLen,
	getAssociatedTokenAddressSync,
	getMetadataPointerState,
	getMintLen,
	getNonTransferable,
	getNonTransferableAccount,
	getTokenMetadata,
	TOKEN_2022_PROGRAM_ID,
	unpackAccount,
	unpackMint,
} from "@solana/spl-token";
import {
	Keypair,
	PublicKey,
	SystemProgram,
	Transaction,
} from "@solana/web3.js";
import { PassportAuthFault } from "./passport-durable-auth.mjs";

const GENESIS = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
const NAME = "Solve3 Devnet Pass",
	SYMBOL = "S3PASS";
const fault = (code = "UNAVAILABLE") => {
	throw new PassportAuthFault(code);
};

// A stable, domain-separated per-wallet key means retries/crash recovery never
// allocate a second mint. The master seed is mounted read-only, never a payer.
export function derivePassMint(seed, wallet) {
	if (!(seed instanceof Uint8Array) || seed.length !== 32) fault();
	const key = new PublicKey(wallet);
	if (key.toBase58() !== wallet) fault("INVALID_REQUEST");
	return Keypair.fromSeed(
		createHmac("sha256", seed)
			.update(`solve3:devnet:pass:v1:${wallet}`)
			.digest(),
	);
}

export async function buildUserPaidPassTransaction({
	connection,
	wallet,
	mint,
	origin,
}) {
	if ((await connection.getGenesisHash()) !== GENESIS) fault();
	const user = new PublicKey(wallet),
		address = mint.publicKey;
	const uri = `${origin}/assets/pass/devnet-explorer.json`;
	const space = getMintLen([
		ExtensionType.NonTransferable,
		ExtensionType.MetadataPointer,
	]);
	// TokenMetadata TLV header + fixed fields/string lengths + UTF-8 strings.
	const metadataSpace = 4 + 80 + Buffer.byteLength(NAME + SYMBOL + uri);
	const rent = await connection.getMinimumBalanceForRentExemption(
		space + metadataSpace,
		"confirmed",
	);
	if (!Number.isSafeInteger(rent) || rent < 1 || rent > 100_000_000) fault();
	const ata = getAssociatedTokenAddressSync(
		address,
		user,
		false,
		TOKEN_2022_PROGRAM_ID,
	);
	const latest = await connection.getLatestBlockhash("confirmed");
	const tx = new Transaction({ feePayer: user, ...latest });
	tx.add(
		SystemProgram.createAccount({
			fromPubkey: user,
			newAccountPubkey: address,
			lamports: rent,
			space,
			programId: TOKEN_2022_PROGRAM_ID,
		}),
		createInitializeNonTransferableMintInstruction(
			address,
			TOKEN_2022_PROGRAM_ID,
		),
		createInitializeMetadataPointerInstruction(
			address,
			null,
			address,
			TOKEN_2022_PROGRAM_ID,
		),
		createInitializeMintInstruction(
			address,
			0,
			address,
			null,
			TOKEN_2022_PROGRAM_ID,
		),
		createInitializeInstruction({
			programId: TOKEN_2022_PROGRAM_ID,
			metadata: address,
			updateAuthority: address,
			mint: address,
			mintAuthority: address,
			name: NAME,
			symbol: SYMBOL,
			uri,
		}),
		createAssociatedTokenAccountIdempotentInstruction(
			user,
			ata,
			user,
			address,
			TOKEN_2022_PROGRAM_ID,
			ASSOCIATED_TOKEN_PROGRAM_ID,
		),
		createMintToCheckedInstruction(
			address,
			ata,
			address,
			1n,
			0,
			[],
			TOKEN_2022_PROGRAM_ID,
		),
		createSetAuthorityInstruction(
			address,
			address,
			AuthorityType.MintTokens,
			null,
			[],
			TOKEN_2022_PROGRAM_ID,
		),
	);
	tx.partialSign(mint);
	const fee = (
		await connection.getFeeForMessage(tx.compileMessage(), "confirmed")
	).value;
	const ataSpace = getAccountLen([
		ExtensionType.ImmutableOwner,
		ExtensionType.NonTransferableAccount,
	]); // ImmutableOwner and NonTransferableAccount TLVs on a Token-2022 ATA.
	const ataRent = await connection.getMinimumBalanceForRentExemption(
		ataSpace,
		"confirmed",
	);
	if (
		!Number.isSafeInteger(fee) ||
		fee < 0 ||
		fee > 1_000_000 ||
		!Number.isSafeInteger(ataRent) ||
		ataRent < 1 ||
		ataRent > 100_000_000
	)
		fault();
	return {
		network: "DEVNET",
		fixtureKind: "SYNTHETIC_DEVNET",
		awardEligible: false,
		mint: address.toBase58(),
		wallet,
		transaction: tx
			.serialize({ requireAllSignatures: false })
			.toString("base64"),
		blockhash: latest.blockhash,
		lastValidBlockHeight: latest.lastValidBlockHeight,
		mintRentLamports: rent,
		tokenAccountRentLamports: ataRent,
		feeLamports: fee,
		maxCostLamports: rent + ataRent + fee,
	};
}

export async function verifyUserPaidPass({ connection, wallet, mint, origin }) {
	if ((await connection.getGenesisHash()) !== GENESIS) fault();
	const user = new PublicKey(wallet),
		address = new PublicKey(mint);
	const ata = getAssociatedTokenAddressSync(
		address,
		user,
		false,
		TOKEN_2022_PROGRAM_ID,
	);
	const accounts = await connection.getMultipleAccountsInfo(
		[address, ata],
		"finalized",
	);
	if (accounts[0] === null && accounts[1] === null) return false;
	if (
		!accounts[0]?.owner.equals(TOKEN_2022_PROGRAM_ID) ||
		!accounts[1]?.owner.equals(TOKEN_2022_PROGRAM_ID)
	)
		fault();
	const m = unpackMint(address, accounts[0], TOKEN_2022_PROGRAM_ID),
		a = unpackAccount(ata, accounts[1], TOKEN_2022_PROGRAM_ID);
	const pointer = getMetadataPointerState(m);
	if (
		!m.isInitialized ||
		m.decimals !== 0 ||
		m.supply !== 1n ||
		m.mintAuthority !== null ||
		m.freezeAuthority !== null ||
		!getNonTransferable(m) ||
		!getNonTransferableAccount(a) ||
		!a.owner.equals(user) ||
		!a.mint.equals(address) ||
		a.amount !== 1n ||
		a.delegate !== null ||
		a.closeAuthority !== null ||
		!pointer?.metadataAddress?.equals(address) ||
		pointer.authority !== null
	)
		fault();
	const metadata = await getTokenMetadata(
		connection,
		address,
		"finalized",
		TOKEN_2022_PROGRAM_ID,
	);
	if (
		!metadata?.mint.equals(address) ||
		metadata.name !== NAME ||
		metadata.symbol !== SYMBOL ||
		metadata.uri !== `${origin}/assets/pass/devnet-explorer.json` ||
		!metadata.updateAuthority?.equals(address)
	)
		fault();
	return true;
}

export function createUserPaidPassService({ auth, connection, seed, origin }) {
	if (auth.origin !== origin || new URL(origin).protocol !== "https:") fault();
	const identity = (authentication, context, work) =>
		auth.withSession(authentication, context, work);
	async function reservation(authentication, context, create) {
		return identity(authentication, context, async ({ client, session }) => {
			const expected = derivePassMint(
				seed,
				session.wallet,
			).publicKey.toBase58();
			if (create)
				await client.query(
					"INSERT INTO quest.pass_mint_reservations(network,wallet,passport_id,mint) VALUES('DEVNET',$1,$2,$3) ON CONFLICT (network,wallet) DO NOTHING",
					[session.wallet, session.passportId, expected],
				);
			const r = await client.query(
				"SELECT mint,verified_at IS NOT NULL AS verified FROM quest.pass_mint_reservations WHERE network='DEVNET' AND wallet=$1 AND passport_id=$2",
				[session.wallet, session.passportId],
			);
			if (r.rows.length !== 1 || r.rows[0].mint !== expected) fault();
			return {
				wallet: session.wallet,
				passportId: session.passportId,
				mint: expected,
				verified: r.rows[0].verified,
			};
		});
	}
	async function check(row, authentication, context) {
		const valid = await verifyUserPaidPass({ connection, ...row, origin });
		if (valid)
			await identity(authentication, context, async ({ client, session }) => {
				if (
					session.wallet !== row.wallet ||
					session.passportId !== row.passportId
				)
					fault("FORBIDDEN");
				await client.query(
					"UPDATE quest.pass_mint_reservations SET verified_at=clock_timestamp() WHERE network='DEVNET' AND wallet=$1 AND passport_id=$2 AND mint=$3 AND verified_at IS NULL",
					[row.wallet, row.passportId, row.mint],
				);
			});
		// Recheck the signed identity after external RPC work before disclosing its result.
		return identity(authentication, context, async ({ session }) => {
			if (
				session.wallet !== row.wallet ||
				session.passportId !== row.passportId
			)
				fault("FORBIDDEN");
			return {
				network: "DEVNET",
				awardEligible: false,
				mint: row.mint,
				wallet: row.wallet,
				status: valid ? "MINTED" : row.verified ? "UNAVAILABLE" : "NOT_MINTED",
			};
		});
	}
	return {
		async prepare(authentication, context) {
			const row = await reservation(authentication, context, true);
			const status = await check(row, authentication, context);
			if (status.status === "MINTED") return status;
			if (await connection.getAccountInfo(new PublicKey(row.mint), "confirmed"))
				return { ...status, status: "PENDING" };
			if (row.verified) fault(); // Never remint a previously confirmed pass after burn/close.
			const height = await connection.getBlockHeight("finalized");
			if (!Number.isSafeInteger(height) || height < 0) fault();
			const cached = await identity(
				authentication,
				context,
				async ({ client, session }) => {
					if (
						session.wallet !== row.wallet ||
						session.passportId !== row.passportId
					)
						fault("FORBIDDEN");
					const r = await client.query(
						"SELECT prepared FROM quest.pass_mint_reservations WHERE network='DEVNET' AND wallet=$1 AND passport_id=$2 AND verified_at IS NULL",
						[row.wallet, row.passportId],
					);
					return r.rows[0]?.prepared;
				},
			);
			if (cached && cached.lastValidBlockHeight >= height) return cached;
			const value = await buildUserPaidPassTransaction({
				connection,
				wallet: row.wallet,
				mint: derivePassMint(seed, row.wallet),
				origin,
			});
			return identity(authentication, context, async ({ client, session }) => {
				if (
					session.wallet !== row.wallet ||
					session.passportId !== row.passportId
				)
					fault("FORBIDDEN");
				const r = await client.query(
					"SELECT prepared FROM quest.pass_mint_reservations WHERE network='DEVNET' AND wallet=$1 AND passport_id=$2 AND verified_at IS NULL FOR UPDATE",
					[row.wallet, row.passportId],
				);
				if (r.rows.length !== 1) fault();
				if (r.rows[0].prepared?.lastValidBlockHeight >= height)
					return r.rows[0].prepared;
				const plan = { ...value, status: "PREPARED" };
				await client.query(
					"UPDATE quest.pass_mint_reservations SET prepared=$3::jsonb WHERE network='DEVNET' AND wallet=$1 AND passport_id=$2 AND verified_at IS NULL",
					[row.wallet, row.passportId, JSON.stringify(plan)],
				);
				return plan;
			});
		},
		async status(authentication, context) {
			// Reserve the stable address first, also supports recovery after a lost HTTP response.
			const row = await reservation(authentication, context, true);
			return check(row, authentication, context);
		},
	};
}
