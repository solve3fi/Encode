import fs from "node:fs";
import { AnchorProvider, BN, Program, Wallet } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, SystemProgram } from "@solana/web3.js";

const RPC = process.env.SOLVE3_DEVNET_RPC ?? "https://api.devnet.solana.com";
const KEYPAIR_PATH = process.env.SOLVE3_DEVNET_KEYPAIR;
if (!KEYPAIR_PATH) throw new Error("SOLVE3_DEVNET_KEYPAIR is required");
const IDL_PATH =
	process.env.VESOLVE_IDL ??
	new URL("../src/configs/vesolve.json", import.meta.url);
const PROGRAM_ID = new PublicKey(
	"HUk7bMPwzxgJyrjrTsLZjZVuLj5YDbm3bgfL9MA1r3us",
);
const GAUGES = [
	["BONK3", "BUQBUdS93v2yrqG1T6SKdSrDSW7s4KwQT3MYXqBpD1B8"],
	["WIF3", "6Hqa6TYH4U12MAbktXDMbwAxcjpm7AQQsFrrkviGsSvB"],
	["PEPE3", "9LcB8K6rWizVSy68uuEYnTNCMR3p62NAkns4YwujmcLb"],
];
const weights = (process.env.SOLVE3_VOTE_WEIGHTS ?? "20,30,50")
	.split(",")
	.map((value) => Number.parseInt(value.trim(), 10));
if (
	weights.length !== GAUGES.length ||
	weights.some((value) => !Number.isInteger(value) || value < 0)
) {
	throw new Error(
		"SOLVE3_VOTE_WEIGHTS must contain three non-negative integers",
	);
}
if (weights.reduce((sum, value) => sum + value, 0) !== 100) {
	throw new Error("SOLVE3_VOTE_WEIGHTS must total 100");
}

const payer = Keypair.fromSecretKey(
	Uint8Array.from(JSON.parse(fs.readFileSync(KEYPAIR_PATH, "utf8"))),
);
const connection = new Connection(RPC, "confirmed");
const wallet = new Wallet(payer);
const provider = new AnchorProvider(connection, wallet, {
	commitment: "confirmed",
	preflightCommitment: "confirmed",
	maxRetries: 8,
});
const program = new Program(
	JSON.parse(fs.readFileSync(IDL_PATH, "utf8")),
	provider,
);
if (!program.programId.equals(PROGRAM_ID))
	throw new Error("Unexpected vesolve program ID");

const pda = (seeds) => PublicKey.findProgramAddressSync(seeds, PROGRAM_ID)[0];
const u64 = (value) => new BN(value).toArrayLike(Buffer, "le", 8);
const protocolAddress = pda([Buffer.from("protocol")]);
const protocol = await program.account.protocol.fetch(protocolAddress);
const epochNumber = protocol.currentEpoch;
const epochAddress = pda([Buffer.from("epoch_data"), u64(epochNumber)]);
const epoch = await program.account.epoch.fetch(epochAddress);
if (Math.floor(Date.now() / 1000) + 4 * 60 * 60 >= epoch.endTime.toNumber()) {
	throw new Error("Voting is closed for this epoch");
}

let selectedLock = null;
for (let id = 0; id < protocol.nextNftTokenId.toNumber(); id += 1) {
	const address = pda([Buffer.from("ve_lock"), u64(id)]);
	const lock = await program.account.lock.fetchNullable(address);
	if (lock?.owner.equals(wallet.publicKey) && lock.votingPower.gt(new BN(0))) {
		if (!selectedLock || lock.votingPower.gt(selectedLock.state.votingPower)) {
			selectedLock = { id: new BN(id), address, state: lock };
		}
	}
}
if (!selectedLock)
	throw new Error(
		`No funded veSOLV3 lock belongs to ${wallet.publicKey.toBase58()}`,
	);

const gaugeVotes = GAUGES.map(([symbol, address], index) => ({
	symbol,
	gauge: new PublicKey(address),
	weight: new BN(weights[index]),
}));
for (const item of gaugeVotes) {
	const gauge = await program.account.gauge.fetch(item.gauge);
	if (!gauge.isActive) throw new Error(`${item.symbol} gauge is not active`);
}

const userVoteAddress = pda([
	Buffer.from("user_vote"),
	wallet.publicKey.toBuffer(),
	u64(epochNumber),
]);
const voteLockRecordAddress = pda([
	Buffer.from("vote_lock"),
	wallet.publicKey.toBuffer(),
	u64(epochNumber),
]);
const signature = await program.methods
	.vote(
		selectedLock.id,
		gaugeVotes.map(({ gauge, weight }) => ({ gauge, weight })),
	)
	.accounts({
		user: wallet.publicKey,
		protocol: protocolAddress,
		epoch: epochAddress,
		lock: selectedLock.address,
		userVote: userVoteAddress,
		voteLockRecord: voteLockRecordAddress,
		systemProgram: SystemProgram.programId,
	})
	.remainingAccounts(
		gaugeVotes.map(({ gauge }) => ({
			pubkey: gauge,
			isWritable: false,
			isSigner: false,
		})),
	)
	.rpc();

console.log(
	JSON.stringify(
		{
			epoch: epochNumber.toNumber(),
			voter: wallet.publicKey.toBase58(),
			lockId: selectedLock.id.toNumber(),
			votingPower: selectedLock.state.votingPower.toString(),
			weights: Object.fromEntries(
				gaugeVotes.map(({ symbol }, index) => [symbol, weights[index]]),
			),
			signature,
		},
		null,
		2,
	),
);
