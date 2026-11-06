import fs from "node:fs";
import { AnchorProvider, BN, Program, Wallet } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import idl from "../src/configs/vesolve.json" with { type: "json" };

// One-off devnet verification for the Public Auto-Vote feature: proves the
// delegated-voting mechanism actually works end-to-end against the deployed
// program before the keeper script and frontend get built on top of it.
// Not meant to be a permanent script -- mirrors the ad-hoc verify-*.mjs
// scripts already in this directory (verify-bribe-fix.mjs etc).

const RPC = process.env.SOLVE3_DEVNET_RPC ?? "https://api.devnet.solana.com";
const PROGRAM_ID = new PublicKey(idl.address);

const ownerKeypair = Keypair.fromSecretKey(
	Uint8Array.from(
		JSON.parse(fs.readFileSync("D:/Projects/ve33-contracts/id.json", "utf8")),
	),
);
const keeperKeypair = Keypair.fromSecretKey(
	Uint8Array.from(
		JSON.parse(
			fs.readFileSync(
				"D:/Projects/ve33-contracts/auto-vote-keeper.json",
				"utf8",
			),
		),
	),
);

const connection = new Connection(RPC, "confirmed");
const pda = (seeds) => PublicKey.findProgramAddressSync(seeds, PROGRAM_ID)[0];
const u64 = (value) => new BN(value).toArrayLike(Buffer, "le", 8);

const ownerProvider = new AnchorProvider(connection, new Wallet(ownerKeypair), {
	commitment: "confirmed",
	preflightCommitment: "confirmed",
});
const ownerProgram = new Program(idl, ownerProvider);

const keeperProvider = new AnchorProvider(
	connection,
	new Wallet(keeperKeypair),
	{
		commitment: "confirmed",
		preflightCommitment: "confirmed",
	},
);
const keeperProgram = new Program(idl, keeperProvider);

const protocolAddress = pda([Buffer.from("protocol")]);
const protocol = await ownerProgram.account.protocol.fetch(protocolAddress);
const currentEpoch = protocol.currentEpoch;
const epochAddress = pda([Buffer.from("epoch_data"), u64(currentEpoch)]);
const epoch = await ownerProgram.account.epoch.fetch(epochAddress);
if (Math.floor(Date.now() / 1000) + 4 * 60 * 60 >= epoch.endTime.toNumber()) {
	throw new Error(
		"Voting is closed for this epoch -- rerun after the next epoch rolls over",
	);
}

let selectedLock = null;
for (let id = 0; id < protocol.nextNftTokenId.toNumber(); id += 1) {
	const address = pda([Buffer.from("ve_lock"), u64(id)]);
	const lock = await ownerProgram.account.lock.fetchNullable(address);
	if (
		lock?.owner.equals(ownerKeypair.publicKey) &&
		lock.votingPower.gt(new BN(0))
	) {
		if (!selectedLock || lock.votingPower.gt(selectedLock.state.votingPower)) {
			selectedLock = { id: new BN(id), address, state: lock };
		}
	}
}
if (!selectedLock)
	throw new Error(
		`No funded veSOLV3 lock belongs to ${ownerKeypair.publicKey.toBase58()}`,
	);
console.log(
	`Using lock #${selectedLock.id.toNumber()} at ${selectedLock.address.toBase58()}`,
);

const enrollmentAddress = pda([
	Buffer.from("auto_vote"),
	selectedLock.address.toBuffer(),
]);

// Step 1: owner enrolls the lock. Idempotent -- a prior interrupted run may
// have already enrolled it (enroll_auto_vote uses `init`, so re-enrolling an
// already-enrolled lock errors rather than no-ops).
const existingEnrollment =
	await ownerProgram.account.autoVoteEnrollment.fetchNullable(
		enrollmentAddress,
	);
if (existingEnrollment) {
	console.log("already enrolled (resuming from a prior run)");
} else {
	const enrollSig = await ownerProgram.methods
		.enrollAutoVote(selectedLock.id)
		.accounts({
			owner: ownerKeypair.publicKey,
			lock: selectedLock.address,
			enrollment: enrollmentAddress,
			systemProgram: SystemProgram.programId,
		})
		.rpc();
	await connection.confirmTransaction(enrollSig, "confirmed");
	console.log("enroll_auto_vote:", enrollSig);
}

const enrollment =
	await ownerProgram.account.autoVoteEnrollment.fetch(enrollmentAddress);
if (!enrollment.lock.equals(selectedLock.address))
	throw new Error("Enrollment lock mismatch");
if (!enrollment.owner.equals(ownerKeypair.publicKey))
	throw new Error("Enrollment owner mismatch");
console.log("enrollment verified:", {
	lock: enrollment.lock.toBase58(),
	owner: enrollment.owner.toBase58(),
});

// Step 2: an unrelated gauge, picked at random from whatever exists, so we
// have something real to vote for.
const gauges = await ownerProgram.account.gauge.all();
const activeGauge = gauges.find((g) => g.account.isActive);
if (!activeGauge) throw new Error("No active gauge exists to vote for");
console.log(`Voting for gauge ${activeGauge.publicKey.toBase58()}`);

const userVoteAddress = pda([
	Buffer.from("user_vote"),
	ownerKeypair.publicKey.toBuffer(), // == lock.owner
	u64(currentEpoch),
]);
const voteLockRecordAddress = pda([
	Buffer.from("vote_lock"),
	ownerKeypair.publicKey.toBuffer(), // == lock.owner
	u64(currentEpoch),
]);

// Step 3: the KEEPER signs the vote, not the owner -- this is the core thing
// being proven: a keeper-signed vote() on an enrolled lock is authorized and
// records the vote under the lock's owner.
const voteSig = await keeperProgram.methods
	.vote(selectedLock.id, [
		{ gauge: activeGauge.publicKey, weight: new BN(100) },
	])
	.accounts({
		user: keeperKeypair.publicKey,
		protocol: protocolAddress,
		epoch: epochAddress,
		lock: selectedLock.address,
		autoVoteEnrollment: enrollmentAddress,
		userVote: userVoteAddress,
		voteLockRecord: voteLockRecordAddress,
		systemProgram: SystemProgram.programId,
	})
	.remainingAccounts([
		{ pubkey: activeGauge.publicKey, isWritable: false, isSigner: false },
	])
	.rpc();
await connection.confirmTransaction(voteSig, "confirmed");
console.log("vote (signed by keeper):", voteSig);

const userVote = await ownerProgram.account.userVote.fetch(userVoteAddress);
if (!userVote.user.equals(ownerKeypair.publicKey)) {
	throw new Error(
		`user_vote.user mismatch: expected owner, got ${userVote.user.toBase58()}`,
	);
}
console.log(
	"user_vote.user correctly recorded as lock owner:",
	userVote.user.toBase58(),
);
console.log(
	"user_vote.votes:",
	userVote.votes.map((v) => ({
		gauge: v.gauge.toBase58(),
		weight: v.weight.toString(),
	})),
);

// Step 4: a non-enrolled, non-owner signer must be REJECTED.
try {
	await keeperProgram.methods
		.vote(selectedLock.id, [
			{ gauge: activeGauge.publicKey, weight: new BN(100) },
		])
		.accounts({
			user: keeperKeypair.publicKey,
			protocol: protocolAddress,
			epoch: epochAddress,
			lock: selectedLock.address,
			autoVoteEnrollment: null,
			userVote: userVoteAddress,
			systemProgram: SystemProgram.programId,
		})
		.remainingAccounts([
			{ pubkey: activeGauge.publicKey, isWritable: false, isSigner: false },
		])
		.rpc();
	throw new Error(
		"SECURITY BUG: keeper vote without enrollment account was NOT rejected",
	);
} catch (error) {
	const message = error instanceof Error ? error.message : String(error);
	if (message.includes("SECURITY BUG")) throw error;
	console.log(
		"keeper vote without enrollment correctly rejected:",
		message.split("\n")[0],
	);
}

// Step 5: revoke and confirm the enrollment account is closed.
const revokeSig = await ownerProgram.methods
	.revokeAutoVote(selectedLock.id)
	.accounts({
		owner: ownerKeypair.publicKey,
		lock: selectedLock.address,
		enrollment: enrollmentAddress,
	})
	.rpc();
await connection.confirmTransaction(revokeSig, "confirmed");
console.log("revoke_auto_vote:", revokeSig);

const closedEnrollment = await connection.getAccountInfo(enrollmentAddress);
if (closedEnrollment !== null)
	throw new Error("Enrollment account was not closed by revoke_auto_vote");
console.log("enrollment account confirmed closed");

// Step 6: after revoke, the keeper must be rejected again (enrollment gone).
try {
	await keeperProgram.methods
		.vote(selectedLock.id, [
			{ gauge: activeGauge.publicKey, weight: new BN(100) },
		])
		.accounts({
			user: keeperKeypair.publicKey,
			protocol: protocolAddress,
			epoch: epochAddress,
			lock: selectedLock.address,
			autoVoteEnrollment: enrollmentAddress, // stale/closed address, will fail deserialization
			userVote: userVoteAddress,
			systemProgram: SystemProgram.programId,
		})
		.remainingAccounts([
			{ pubkey: activeGauge.publicKey, isWritable: false, isSigner: false },
		])
		.rpc();
	throw new Error("SECURITY BUG: keeper vote after revoke was NOT rejected");
} catch (error) {
	const message = error instanceof Error ? error.message : String(error);
	if (message.includes("SECURITY BUG")) throw error;
	console.log(
		"keeper vote after revoke correctly rejected:",
		message.split("\n")[0],
	);
}

console.log("\nALL PUBLIC AUTO-VOTE CHECKS PASSED");
