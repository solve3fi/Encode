// DEPRECATED for the standard 7-day deployment: the POOLS below name the retired September 18 devnet pools and meme
// mints. Gauges for the current pools are created by the contracts repo (scripts/devnet/setup-gauges.mjs) with
// create_gauge + schedule_gauge_activation. Do not run this script as is.
import fs from "node:fs";
import { AnchorProvider, BN, Program, Wallet } from "@coral-xyz/anchor";
import {
	ASSOCIATED_TOKEN_PROGRAM_ID,
	createAssociatedTokenAccountInstruction,
	getAssociatedTokenAddressSync,
	TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
	ComputeBudgetProgram,
	Connection,
	Keypair,
	PublicKey,
	SYSVAR_RENT_PUBKEY,
	SystemProgram,
	sendAndConfirmTransaction,
	Transaction,
} from "@solana/web3.js";
import { SolveContext } from "@solve3fi/sdk";
import { configureNativeGaugeAccounts } from "../src/lib/nativeGaugeAccounts.ts";

// Kept separate for offline tests: this function never collects or redistributes
// accrued fees. Both programs must accept the same signer, or nothing is created.
async function createSeedGaugeWithFeePolicy({
	program,
	dexContext,
	wallet,
	protocol,
	gauge,
	dexConfig,
	pool,
	mintA,
	mintB,
	tickSpacing,
}) {
	const config = await dexContext.program.account.solvesConfig.fetch(dexConfig);
	if (!config.feeAuthority.equals(wallet.publicKey)) {
		throw new Error(
			`Seed signer ${wallet.publicKey.toBase58()} is not DEX fee authority ${config.feeAuthority.toBase58()}; gauge creation requires the fee-authority wallet so the fee split changes atomically`,
		);
	}
	const poolData = await dexContext.program.account.solve.fetch(pool);
	if (
		!poolData.solvesConfig.equals(dexConfig) ||
		!poolData.tokenMintA.equals(mintA) ||
		!poolData.tokenMintB.equals(mintB) ||
		poolData.tickSpacing !== tickSpacing
	) {
		throw new Error(
			`Seed pool ${pool.toBase58()} details do not match this DEX; no gauge was created`,
		);
	}
	const protocolState = await program.account.protocol.fetch(protocol);
	const feeInstruction = await program.methods
		.configureNativeGauge(true)
		.accounts(
			configureNativeGaugeAccounts({
				admin: wallet.publicKey,
				protocol,
				gauge,
				pool,
				solvesConfig: dexConfig,
				tokenMintA: poolData.tokenMintA,
				tokenMintB: poolData.tokenMintB,
				rewardMint: protocolState.tokenMint,
				programId: program.programId,
				dexProgramId: dexContext.program.programId,
			}),
		)
		.instruction();
	return (
		program.methods
			// Normalize SDK public keys to this web3.js copy for Anchor's Buffer encoder.
			.createGauge(
				pool,
				new PublicKey(poolData.tokenMintA.toString()),
				new PublicKey(poolData.tokenMintB.toString()),
				poolData.tickSpacing,
			)
			.accounts({
				admin: wallet.publicKey,
				protocol,
				gauge,
				systemProgram: SystemProgram.programId,
			})
			.postInstructions([feeInstruction])
			.preInstructions([
				ComputeBudgetProgram.setComputeUnitLimit({ units: 600_000 }),
			])
			.rpc({ commitment: "confirmed" })
	);
}

const RPC = process.env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com";
const KEYPAIR_PATH =
	process.env.SOLVE3_KEYPAIR ?? "D:/Projects/ve33-contracts/id.json";
const IDL_PATH =
	process.env.VESOLVE_IDL ??
	new URL("../src/configs/vesolve.json", import.meta.url);
const PROGRAM_ID = new PublicKey(
	"HUk7bMPwzxgJyrjrTsLZjZVuLj5YDbm3bgfL9MA1r3us",
);
const DEX_PROGRAM_ID = new PublicKey(
	"Bwkxu4ZnWgPAwCCfBmT3D95EmdiMVuY88Rs7mTBaKysb",
);
const DEX_CONFIG = new PublicKey(
	"Fnc66UJ8MMJ6t2zFM8TEx5wzcQpcXo8pAQEpTBjwnEBG",
);
const SOLV3 = new PublicKey("9Xn8ko7AwH8HBRLt6Ci6oYxFjPN1sBoUrkDWeTPCPacn");
const METADATA_PROGRAM_ID = new PublicKey(
	"metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s",
);
const LOCK_AMOUNT = new BN("10000000000000"); // 10,000 SOLV3 (9 decimals)
const EMISSION_PER_GAUGE = new BN("1000000000000"); // 1,000 SOLV3
const POOLS = [
	{
		symbol: "BONK3",
		pool: "BCC4rnG5NBHEVFGJFp2TZxdCMPka5mJ1x4j672dpfG5m",
		mint: "7AZHRvD2haCReWLLjQXMVbfgkvgha3FuxsyWdkT9d9QM",
		weight: 34,
	},
	{
		symbol: "WIF3",
		pool: "7BgMo5hvWLX3u2QRfvVq6iT4JYJ3ksdcZDed6w9fWdjz",
		mint: "294YpSBwicjzKggcn9aZozVDfxHbM3EcBStQXiWcG8sk",
		weight: 33,
	},
	{
		symbol: "PEPE3",
		pool: "Eti9a1NvJ2AZtU4TXcV4XJQycmcPiYrMniNaa3GQmSBi",
		mint: "3TokhXnDGCShfn1N2XsQDBL1rGmco37Kq2bWizdmKU5f",
		weight: 33,
	},
];

const bytesU64 = (value) => new BN(value).toArrayLike(Buffer, "le", 8);
const pda = (seeds) => PublicKey.findProgramAddressSync(seeds, PROGRAM_ID)[0];
const keypair = Keypair.fromSecretKey(
	Uint8Array.from(JSON.parse(fs.readFileSync(KEYPAIR_PATH, "utf8"))),
);
const connection = new Connection(RPC, "confirmed");
const wallet = new Wallet(keypair);
const provider = new AnchorProvider(connection, wallet, {
	commitment: "confirmed",
	preflightCommitment: "confirmed",
	skipPreflight: false,
	maxRetries: 8,
});
const idl = JSON.parse(fs.readFileSync(IDL_PATH, "utf8"));
const program = new Program(idl, provider);
const dexContext = SolveContext.from(connection, wallet, DEX_PROGRAM_ID);
if (!program.programId.equals(PROGRAM_ID))
	throw new Error("Unexpected vesolve program ID");

const protocolPda = pda([Buffer.from("protocol")]);
let protocol = await program.account.protocol.fetch(protocolPda);
const gauges = [];

for (const item of POOLS) {
	const pool = new PublicKey(item.pool);
	const meme = new PublicKey(item.mint);
	const [mintA, mintB] =
		SOLV3.toBuffer().compare(meme.toBuffer()) < 0
			? [SOLV3, meme]
			: [meme, SOLV3];
	const gauge = pda([
		Buffer.from("gauge"),
		protocolPda.toBuffer(),
		pool.toBuffer(),
	]);
	if (!(await connection.getAccountInfo(gauge, "confirmed"))) {
		const signature = await createSeedGaugeWithFeePolicy({
			program,
			dexContext,
			wallet,
			protocol: protocolPda,
			gauge,
			dexConfig: DEX_CONFIG,
			pool,
			mintA,
			mintB,
			tickSpacing: 64,
		});
		console.log(
			`${item.symbol} gauge created with future fees split 80% gauge / 20% LP: ${signature}`,
		);
	} else {
		console.log(`${item.symbol} gauge already exists: ${gauge}`);
	}
	gauges.push({ ...item, pool, mintA, mintB, gauge });
}

const now = Math.floor(Date.now() / 1000);
if (
	now - protocol.epochStartTime.toNumber() >=
	protocol.epochResetTime.toNumber()
) {
	const nextEpoch = protocol.currentEpoch.addn(1);
	const epochPda = pda([Buffer.from("epoch_data"), bytesU64(nextEpoch)]);
	const signature = await program.methods
		.updateEpoch()
		.accounts({
			caller: wallet.publicKey,
			protocol: protocolPda,
			epoch: epochPda,
			systemProgram: SystemProgram.programId,
		})
		.rpc();
	console.log(`Epoch ${nextEpoch.toString()} started: ${signature}`);
	protocol = await program.account.protocol.fetch(protocolPda);
} else {
	console.log(`Epoch ${protocol.currentEpoch.toString()} is already active`);
}

let lockId;
let lockPda;
if (protocol.nextNftTokenId.gt(new BN(0))) {
	const candidateId = protocol.nextNftTokenId.subn(1);
	const candidatePda = pda([Buffer.from("ve_lock"), bytesU64(candidateId)]);
	const candidate = await program.account.lock.fetchNullable(candidatePda);
	if (candidate?.owner.equals(wallet.publicKey)) {
		lockId = candidateId;
		lockPda = candidatePda;
	}
}

if (!lockPda) {
	lockId = protocol.nextNftTokenId;
	lockPda = pda([Buffer.from("ve_lock"), bytesU64(lockId)]);
	const veMint = pda([Buffer.from("ve_token"), bytesU64(lockId)]);
	const userSolv3 = getAssociatedTokenAddressSync(SOLV3, wallet.publicKey);
	const protocolSolv3 = getAssociatedTokenAddressSync(SOLV3, protocolPda, true);
	if (!(await connection.getAccountInfo(protocolSolv3, "confirmed"))) {
		const transaction = new Transaction().add(
			createAssociatedTokenAccountInstruction(
				wallet.publicKey,
				protocolSolv3,
				protocolPda,
				SOLV3,
				TOKEN_PROGRAM_ID,
				ASSOCIATED_TOKEN_PROGRAM_ID,
			),
		);
		const signature = await sendAndConfirmTransaction(
			connection,
			transaction,
			[keypair],
			{
				commitment: "confirmed",
				maxRetries: 8,
			},
		);
		console.log(`Protocol SOLV3 custody account created: ${signature}`);
	}
	const userVeToken = getAssociatedTokenAddressSync(veMint, wallet.publicKey);
	const metadata = PublicKey.findProgramAddressSync(
		[
			Buffer.from("metadata"),
			METADATA_PROGRAM_ID.toBuffer(),
			veMint.toBuffer(),
		],
		METADATA_PROGRAM_ID,
	)[0];
	const signature = await program.methods
		.createLock(LOCK_AMOUNT, new BN(0))
		.accounts({
			user: wallet.publicKey,
			protocol: protocolPda,
			lock: lockPda,
			userTokenAccount: userSolv3,
			tokenMint: SOLV3,
			protocolTokenAccount: protocolSolv3,
			veMint,
			veTokenAccount: userVeToken,
			metadata,
			systemProgram: SystemProgram.programId,
			tokenProgram: TOKEN_PROGRAM_ID,
			associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
			metadataProgram: METADATA_PROGRAM_ID,
			rent: SYSVAR_RENT_PUBKEY,
		})
		.rpc();
	console.log(`Permanent lock ${lockId.toString()} created: ${signature}`);
} else {
	console.log(`Using existing lock ${lockId.toString()}: ${lockPda}`);
}

protocol = await program.account.protocol.fetch(protocolPda);
const epoch = protocol.currentEpoch;
const epochPda = pda([Buffer.from("epoch_data"), bytesU64(epoch)]);
const userVotePda = pda([
	Buffer.from("user_vote"),
	wallet.publicKey.toBuffer(),
	bytesU64(epoch),
]);
const voteLockRecordPda = pda([
	Buffer.from("vote_lock"),
	wallet.publicKey.toBuffer(),
	bytesU64(epoch),
]);
const gaugeVotes = gauges.map(({ gauge, weight }) => ({
	gauge,
	weight: new BN(weight),
}));
const voteSignature = await program.methods
	.vote(lockId, gaugeVotes)
	.accounts({
		user: wallet.publicKey,
		protocol: protocolPda,
		epoch: epochPda,
		lock: lockPda,
		userVote: userVotePda,
		voteLockRecord: voteLockRecordPda,
		systemProgram: SystemProgram.programId,
	})
	.remainingAccounts(
		gauges.map(({ gauge }) => ({
			pubkey: gauge,
			isWritable: false,
			isSigner: false,
		})),
	)
	.rpc();
console.log(`Vote cast 34/33/33: ${voteSignature}`);

const adminSolv3 = getAssociatedTokenAddressSync(SOLV3, wallet.publicKey);
for (const item of gauges) {
	const vault = pda([
		Buffer.from("vault"),
		bytesU64(epoch),
		item.gauge.toBuffer(),
	]);
	const vaultSolv3 = getAssociatedTokenAddressSync(SOLV3, vault, true);
	if (!(await connection.getAccountInfo(vaultSolv3, "confirmed"))) {
		const transaction = new Transaction().add(
			createAssociatedTokenAccountInstruction(
				wallet.publicKey,
				vaultSolv3,
				vault,
				SOLV3,
				TOKEN_PROGRAM_ID,
				ASSOCIATED_TOKEN_PROGRAM_ID,
			),
		);
		const signature = await sendAndConfirmTransaction(
			connection,
			transaction,
			[keypair],
			{
				commitment: "confirmed",
				maxRetries: 8,
			},
		);
		console.log(
			`${item.symbol} emission vault token account created: ${signature}`,
		);
	}
	const existingVault = await program.account.vaultData.fetchNullable(vault);
	if (!existingVault || existingVault.rewards.isZero()) {
		const signature = await program.methods
			.distributeReward(EMISSION_PER_GAUGE)
			.accounts({
				admin: wallet.publicKey,
				protocol: protocolPda,
				gauge: item.gauge,
				vault,
				tokenMint: SOLV3,
				userTokenAccount: adminSolv3,
				vaultTokenAccount: vaultSolv3,
				systemProgram: SystemProgram.programId,
				tokenProgram: TOKEN_PROGRAM_ID,
				associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
			})
			.rpc();
		console.log(`${item.symbol} received 1,000 SOLV3 emissions: ${signature}`);
	} else {
		console.log(
			`${item.symbol} emissions already funded: ${existingVault.rewards.toString()}`,
		);
	}
}

const lock = await program.account.lock.fetch(lockPda);
const vote = await program.account.userVote.fetch(userVotePda);
const epochData = await program.account.epoch.fetch(epochPda);
console.log(
	JSON.stringify(
		{
			cluster: "devnet",
			epoch: epoch.toString(),
			lock: {
				id: lockId.toString(),
				address: lockPda.toBase58(),
				amount: lock.amount.toString(),
				votingPower: lock.votingPower.toString(),
				permanent: lock.unlockTime.eq(new BN("9223372036854775807")),
			},
			vote: {
				address: userVotePda.toBase58(),
				totalVotingPower: vote.totalVotingPower.toString(),
				allocations: vote.votes.map((entry) => ({
					gauge: entry.gauge.toBase58(),
					weight: entry.weight.toString(),
				})),
			},
			gauges: gauges.map((item) => ({
				symbol: item.symbol,
				pool: item.pool.toBase58(),
				gauge: item.gauge.toBase58(),
			})),
			epochTotalVotes: epochData.totalVotes.toString(),
		},
		null,
		2,
	),
);
