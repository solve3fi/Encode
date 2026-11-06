
import { createDecipheriv, scryptSync } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import anchor from "@coral-xyz/anchor";
import { Keypair, PublicKey } from "@solana/web3.js";
import idl from "../src/configs/vesolve.json" with { type: "json" };
import { runAcceleratorAutomation } from "./accelerator-keeper.mjs";
import { createResilientConnection } from "./lib/resilient-rpc.mjs";

// Votes the pool allocation configured in the Admin UI (Admin Auto-Vote
// Wallets) on behalf of each wallet whose secret key was pasted there. This
// deliberately reads the SAME JSON file the Next.js app's dataStore writes
// (data/admin-auto-vote-wallets.json) directly off disk rather than going
// through the app's HTTP API — this script has no browser/wallet session to
// authenticate with, and it needs the encrypted secret keys the public GET
// endpoint intentionally never returns.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE = path.join(
	__dirname,
	"..",
	"data",
	"admin-auto-vote-wallets.json",
);

const DEFAULT_RPC = "https://api.devnet.solana.com";
const VESOLVE_PROGRAM_ID = new PublicKey(idl.address);

const dryRun = process.argv.includes("--dry-run");

const log = (action, details = {}) => {
	console.log(
		JSON.stringify({ timestamp: new Date().toISOString(), action, ...details }),
	);
};

// Mirrors src/lib/server/secretEncryption.ts exactly — duplicated rather
// than imported because this script runs outside Next.js's module
// resolution (no "@/" alias, no bundling), the same reason
// finalize-devnet-epoch.mjs uses a relative path for the IDL instead of an
// alias. Keep both copies in sync if the encryption scheme ever changes.
const decryptSecret = (encrypted) => {
	const raw = process.env.WALLET_CONFIG_ENCRYPTION_KEY;
	if (!raw) {
		throw new Error("WALLET_CONFIG_ENCRYPTION_KEY is required");
	}
	const key = scryptSync(raw, "solve3-admin-auto-vote-wallets", 32);
	const decipher = createDecipheriv(
		"aes-256-gcm",
		key,
		Buffer.from(encrypted.iv, "base64"),
	);
	decipher.setAuthTag(Buffer.from(encrypted.authTag, "base64"));
	const plaintext = Buffer.concat([
		decipher.update(Buffer.from(encrypted.ciphertext, "base64")),
		decipher.final(),
	]);
	return plaintext.toString("utf8");
};

const readWallets = () => {
	try {
		return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
	} catch (error) {
		if (error.code === "ENOENT") return {};
		throw error;
	}
};

const writeWallets = (wallets) => {
	if (dryRun) return;
	fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
	fs.writeFileSync(DATA_FILE, JSON.stringify(wallets, null, 2), "utf8");
};

const pda = (seeds) =>
	PublicKey.findProgramAddressSync(seeds, VESOLVE_PROGRAM_ID)[0];
const u64 = (value) => new anchor.BN(value).toArrayLike(Buffer, "le", 8);

const connection = createResilientConnection(
	process.env.SOLVE3_RPC_URL ?? process.env.SOLVE3_DEVNET_RPC ?? DEFAULT_RPC,
	"confirmed",
);

const voteForWallet = async (pubkey, config) => {
	const secretKeyJson = decryptSecret(config.encryptedSecretKey);
	const keypair = Keypair.fromSecretKey(
		Uint8Array.from(JSON.parse(secretKeyJson)),
	);
	if (keypair.publicKey.toString() !== pubkey) {
		throw new Error("Decrypted key does not match stored pubkey");
	}

	const wallet = new anchor.Wallet(keypair);
	const provider = new anchor.AnchorProvider(connection, wallet, {
		commitment: "confirmed",
	});
	const program = new anchor.Program(idl, provider);

	const protocolAddress = pda([Buffer.from("protocol")]);
	const protocol = await program.account.protocol.fetch(protocolAddress);
	const currentEpoch = protocol.currentEpoch.toNumber();
	const epochAddress = pda([Buffer.from("epoch_data"), u64(currentEpoch)]);
	const locks = await program.account.lock.all([
		{ memcmp: { offset: 8, bytes: keypair.publicKey.toBase58() } },
	]);
	if (locks.length === 0) {
		throw new Error("This wallet holds no veSOLV3 lock to vote with");
	}
	// UserVote is keyed by [user, epoch] — not by lock — so one vote() call
	// per wallet per epoch is what the on-chain account model supports. A
	// wallet configured here is expected to hold exactly one lock; if it
	// holds more, only the first is voted with and the rest are ignored.
	const { publicKey: lockAddress, account: lock } = locks[0];
	// The vote accounts are seeded by the LOCK account (as in the deployed program and the app).
	const userVoteAddress = pda([
		Buffer.from("user_vote"),
		lockAddress.toBuffer(),
		u64(currentEpoch),
	]);
	const voteLockRecordAddress = pda([
		Buffer.from("vote_lock"),
		lockAddress.toBuffer(),
		u64(currentEpoch),
	]);
	const extraLocks = locks.length - 1;

	if (config.pools.length === 0) {
		return { currentEpoch, extraLocks: 0, result: { status: "no_pools_configured" } };
	}
	const gaugeVotes = config.pools.map(({ poolAddress, percent }) => ({
		gauge: pda([
			Buffer.from("gauge"),
			protocolAddress.toBuffer(),
			new PublicKey(poolAddress).toBuffer(),
		]),
		weight: new anchor.BN(percent),
	}));

	// Re-voting an already-matching allocation just wastes a transaction and
	// network fee — skip it. A lock that voted for something DIFFERENT this
	// epoch still needs a fresh vote() call, since it replaces the whole
	// allocation rather than merging into it (the same replace-not-merge
	// behavior fixed for the manual Vote UI).
	const existingUserVote =
		await program.account.userVote.fetchNullable(userVoteAddress);
	const alreadyMatches =
		existingUserVote &&
		existingUserVote.votes.length === gaugeVotes.length &&
		existingUserVote.votes.every((vote) =>
			gaugeVotes.some(
				(desired) =>
					desired.gauge.equals(vote.gauge) && desired.weight.eq(vote.weight),
			),
		);
	if (alreadyMatches) {
		return { currentEpoch, extraLocks, result: { status: "already_voted" } };
	}

	if (dryRun) {
		return {
			currentEpoch,
			extraLocks,
			result: { status: "would_vote", pools: config.pools },
		};
	}

	const signature = await program.methods
		.vote(new anchor.BN(lock.veTokenId), gaugeVotes)
		.accounts({
			user: keypair.publicKey,
			protocol: protocolAddress,
			epoch: epochAddress,
			lock: lockAddress,
			userVote: userVoteAddress,
			voteLockRecord: voteLockRecordAddress,
			systemProgram: anchor.web3.SystemProgram.programId,
		})
		.remainingAccounts(
			gaugeVotes.map(({ gauge }) => ({
				pubkey: gauge,
				isWritable: false,
				isSigner: false,
			})),
		)
		.rpc();
	await connection.confirmTransaction(signature, "confirmed");

	return { currentEpoch, extraLocks, result: { status: "voted", signature } };
};

const run = async () => {
	// Accelerator Program: enrol, expire and match partners automatically, writing the result into the
	// accelerator wallet's allocation before it is read below. Never allowed to block voting.
	if (!process.argv.includes("--skip-accelerator")) {
		try {
			await runAcceleratorAutomation({ connection, dryRun, log });
		} catch (error) {
			log("accelerator_automation_failed", {
				error: error instanceof Error ? error.message : String(error),
			});
		}
	}
	const wallets = readWallets();
	const entries = Object.entries(wallets);
	if (entries.length === 0) {
		log("no_wallets_configured");
		return;
	}

	for (const [pubkey, config] of entries) {
		try {
			const { currentEpoch, extraLocks, result } = await voteForWallet(
				pubkey,
				config,
			);
			log("wallet_processed", {
				pubkey,
				label: config.label,
				extraLocks,
				...result,
			});

			wallets[pubkey] = {
				...config,
				lastError: undefined,
				...(result.status === "voted"
					? {
							lastVotedEpoch: currentEpoch,
							lastVotedAt: Date.now(),
							lastSignature: result.signature,
						}
					: {}),
			};
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			log("wallet_failed", { pubkey, label: config?.label, error: message });
			wallets[pubkey] = { ...config, lastError: message };
		}
	}

	writeWallets(wallets);
};

await run();
