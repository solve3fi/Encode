import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AnchorProvider, BN, Program, Wallet } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import idl from "../src/configs/vesolve.json" with { type: "json" };
import { partnerVoteTargets } from "./lib/partner-vote-targets.mjs";

// Votes every lock enrolled in Public Auto-Vote (see AutoVoteEnrollment in
// the vesolve program) toward whichever gauges its own veSOLV3 power would
// earn the most reward from this epoch, ranked by a HEURISTIC -- devnet has
// no price oracle. Mainnet will price every reward token via Pyth and rank
// gauges by true USD reward-per-vote; until then this only prices the one
// token it actually knows the value of, devUSDC, pegged to exactly $1 the
// same way the rest of the app already treats it (src/hooks/useUSDCPrice.ts).
// A DEX-route price for anything else would be meaningless on devnet anyway
// -- solve3's own pools are thin/empty there, so useUSDCPrice's router
// quotes for non-devUSDC tokens already silently fail in the app today.
// Reward tokens the keeper can't price are simply left out of the score,
// same degrade-to-neutral-split behavior optimizeVoteAllocation() already
// has for the admin's manual Vote Optimizer (see below).
//
// Usage:
//   PUBLIC_AUTO_VOTE_KEEPER_KEYPAIR=/path/to/auto-vote-keeper.json \
//     node scripts/public-auto-vote-keeper.mjs [--dry-run]
//
// Keypair custody: for devnet this reads a plain keyfile off disk, same as
// cast-devnet-vote.mjs's SOLVE3_DEVNET_KEYPAIR. Before this keeper ever runs
// unattended against mainnet, its key should move to the same encrypted
// server-side custody as the Admin Auto-Vote Wallets feature
// (src/lib/server/secretEncryption.ts) rather than a plaintext file.

const DATA_DIR =
	process.env.SOLVE3_DATA_DIR ??
	path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data");
const readStore = (name) => {
	try {
		return JSON.parse(fs.readFileSync(path.join(DATA_DIR, `${name}.json`), "utf8"));
	} catch (error) {
		if (error.code === "ENOENT") return {};
		throw error;
	}
};

const DEVNET_USDC_MINT = "FrN7oiLccXBSRCJGoAACUHSp3Efvji7mkwfGpZXcV6Up";
const DEVNET_USDC_DECIMALS = 6;

const RPC =
	process.env.SOLVE3_RPC_URL ??
	process.env.SOLVE3_DEVNET_RPC ??
	"https://api.devnet.solana.com";
const KEEPER_KEYPAIR_PATH = process.env.PUBLIC_AUTO_VOTE_KEEPER_KEYPAIR;
if (!KEEPER_KEYPAIR_PATH)
	throw new Error("PUBLIC_AUTO_VOTE_KEEPER_KEYPAIR is required");

const dryRun = process.argv.includes("--dry-run");

const log = (action, details = {}) => {
	console.log(
		JSON.stringify({ timestamp: new Date().toISOString(), action, ...details }),
	);
};

// Copied from src/utils/voteOptimizer.ts rather than imported -- this script
// runs as plain Node ESM outside Next.js's TypeScript/module resolution,
// same reason auto-vote-keeper.mjs duplicates secretEncryption.ts's decrypt
// logic instead of importing it. Keep in sync if the algorithm changes.
const rewardForAllocation = (
	rewardValueUsd,
	existingVotingPower,
	allocatedVotingPower,
) => {
	if (rewardValueUsd <= 0 || allocatedVotingPower <= 0) return 0;
	return (
		rewardValueUsd *
		(allocatedVotingPower / (existingVotingPower + allocatedVotingPower))
	);
};

const optimizeVoteAllocation = (gauges, totalVotingPower) => {
	const safePower = Math.max(0, totalVotingPower);
	const percentages = gauges.map(() => 0);

	if (gauges.length > 0 && safePower > 0) {
		const hasPricedRewards = gauges.some((gauge) => gauge.rewardValueUsd > 0);

		for (let point = 0; point < 100; point += 1) {
			if (!hasPricedRewards) {
				percentages[point % gauges.length] += 1;
				continue;
			}

			let bestIndex = 0;
			let bestGain = Number.NEGATIVE_INFINITY;

			for (let index = 0; index < gauges.length; index += 1) {
				const gauge = gauges[index];
				const beforePower = (safePower * percentages[index]) / 100;
				const afterPower = (safePower * (percentages[index] + 1)) / 100;
				const gain =
					rewardForAllocation(
						gauge.rewardValueUsd,
						Math.max(0, gauge.existingVotingPower),
						afterPower,
					) -
					rewardForAllocation(
						gauge.rewardValueUsd,
						Math.max(0, gauge.existingVotingPower),
						beforePower,
					);

				if (
					gain > bestGain + Number.EPSILON ||
					(Math.abs(gain - bestGain) <= Number.EPSILON &&
						percentages[index] < percentages[bestIndex])
				) {
					bestGain = gain;
					bestIndex = index;
				}
			}

			percentages[bestIndex] += 1;
		}
	}

	return gauges.map((gauge, index) => ({
		...gauge,
		percent: percentages[index],
	}));
};

const keeperKeypair = Keypair.fromSecretKey(
	Uint8Array.from(JSON.parse(fs.readFileSync(KEEPER_KEYPAIR_PATH, "utf8"))),
);
const connection = new Connection(RPC, "confirmed");
const provider = new AnchorProvider(connection, new Wallet(keeperKeypair), {
	commitment: "confirmed",
	preflightCommitment: "confirmed",
});
const program = new Program(idl, provider);

const pda = (seeds) =>
	PublicKey.findProgramAddressSync(seeds, program.programId)[0];
const u64 = (value) => new BN(value).toArrayLike(Buffer, "le", 8);

// One shared ranking computed per run and applied to every enrolled lock --
// which gauges are worth voting for doesn't depend on any individual lock,
// only how much of ITS power to put behind them (handled per-lock below via
// optimizeVoteAllocation's diminishing-marginal-return curve).
const rankGauges = async (protocolAddress, currentEpoch, epoch) => {
	const allGauges = await program.account.gauge.all();
	const activeGauges = allGauges.filter((g) => g.account.isActive);

	return Promise.all(
		activeGauges.map(async ({ publicKey: gauge, account }) => {
			const vaultAddress = pda([
				Buffer.from("vault"),
				u64(currentEpoch),
				gauge.toBuffer(),
			]);
			const vault = await program.account.vaultData.fetchNullable(vaultAddress);

			let rewardValueUsd = 0;
			const addIfPriceable = (mint, rawAmount) => {
				if (mint !== DEVNET_USDC_MINT) return;
				rewardValueUsd +=
					Number(rawAmount.toString()) / 10 ** DEVNET_USDC_DECIMALS;
			};
			if (vault) {
				addIfPriceable(account.tokenMintA.toString(), vault.poolRewardsA);
				addIfPriceable(account.tokenMintB.toString(), vault.poolRewardsB);
			}
			for (const bribe of epoch.bribes.filter((item) =>
				item.gauge.equals(gauge),
			)) {
				addIfPriceable(bribe.tokenMint.toString(), bribe.amount);
			}

			const gaugeWeight = epoch.gaugeWeights.find((item) =>
				item.gauge.equals(gauge),
			);
			return {
				gauge,
				existingVotingPower: Number(gaugeWeight?.weight.toString() ?? 0) / 1e9,
				rewardValueUsd,
			};
		}),
	);
};

const voteForEnrollment = async ({
	enrollmentAddress,
	lockAddress,
	lock,
	protocolAddress,
	epochAddress,
	currentEpoch,
	rankedGauges,
	forcedGauge,
}) => {
	if (!forcedGauge && rankedGauges.length === 0) {
		return { status: "no_active_gauges" };
	}

	const lockVotingPower = Number(lock.votingPower.toString()) / 1e9;
	if (lockVotingPower <= 0) {
		return { status: "no_voting_power" };
	}

	// A partner who saved "auto-vote for our gauge" puts 100% of the lock behind their own gauge;
	// everyone else follows the shared ranking.
	const allocation = forcedGauge
		? [{ gauge: forcedGauge, percent: 100 }]
		: optimizeVoteAllocation(rankedGauges, lockVotingPower).filter(
				(row) => row.percent > 0,
			);
	if (allocation.length === 0) {
		return { status: "no_allocation" };
	}

	// Both accounts are seeded by the LOCK account (the deployed program and the app agree), not
	// its owner.
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
	const existingUserVote =
		await program.account.userVote.fetchNullable(userVoteAddress);
	const desired = allocation.map(({ gauge, percent }) => ({
		gauge: gauge.toBase58(),
		weight: percent,
	}));

	// user_vote.votes[].weight is the on-chain PROGRAM's computed actual voting
	// power for that gauge (lock.votingPower * percent / 100 -- see vote.rs),
	// not the raw percentage this keeper allocates in. Permanent locks never
	// decay (voting_power is constant), so recomputing that same product
	// against the lock's current power is a safe, stable comparison.
	const expectedRawWeight = (percent) =>
		lock.votingPower.mul(new BN(percent)).div(new BN(100));
	const alreadyMatches =
		existingUserVote &&
		existingUserVote.epoch.eq(currentEpoch) &&
		existingUserVote.votes.length === allocation.length &&
		existingUserVote.votes.every((vote) =>
			allocation.some(
				({ gauge, percent }) =>
					gauge.equals(vote.gauge) &&
					expectedRawWeight(percent).eq(vote.weight),
			),
		);
	if (alreadyMatches) {
		return { status: "already_voted", allocation: desired };
	}

	if (dryRun) {
		return { status: "would_vote", allocation: desired };
	}

	const signature = await program.methods
		.vote(
			lock.veTokenId,
			allocation.map(({ gauge, percent }) => ({
				gauge,
				weight: new BN(percent),
			})),
		)
		.accounts({
			user: keeperKeypair.publicKey,
			protocol: protocolAddress,
			epoch: epochAddress,
			lock: lockAddress,
			autoVoteEnrollment: enrollmentAddress,
			userVote: userVoteAddress,
			voteLockRecord: voteLockRecordAddress,
			systemProgram: SystemProgram.programId,
		})
		.remainingAccounts(
			allocation.map(({ gauge }) => ({
				pubkey: gauge,
				isWritable: false,
				isSigner: false,
			})),
		)
		.rpc();
	await connection.confirmTransaction(signature, "confirmed");

	return { status: "voted", allocation: desired, signature };
};

const run = async () => {
	const protocolAddress = pda([Buffer.from("protocol")]);
	const protocol = await program.account.protocol.fetch(protocolAddress);
	const currentEpoch = protocol.currentEpoch;
	const epochAddress = pda([Buffer.from("epoch_data"), u64(currentEpoch)]);
	const epoch = await program.account.epoch.fetch(epochAddress);

	const nowPlusRevocationDeadline = Math.floor(Date.now() / 1000) + 60 * 60; // mirrors VOTE_REVOCATION_DEADLINE
	if (nowPlusRevocationDeadline >= epoch.endTime.toNumber()) {
		log("voting_closed", { epoch: currentEpoch.toNumber() });
		return;
	}

	const enrollments = await program.account.autoVoteEnrollment.all();
	if (enrollments.length === 0) {
		log("no_enrollments");
		return;
	}

	const rankedGauges = await rankGauges(protocolAddress, currentEpoch, epoch);
	const { targets: partnerTargets, conflicts: partnerConflicts } = partnerVoteTargets({
		spaces: readStore("partner-spaces"),
		defaults: readStore("partner-defaults"),
	});
	if (partnerConflicts.length > 0)
		log("partner_target_conflict", { wallets: partnerConflicts });
	log("gauge_ranking", {
		epoch: currentEpoch.toNumber(),
		gauges: rankedGauges.map((g) => ({
			gauge: g.gauge.toBase58(),
			rewardValueUsd: g.rewardValueUsd,
			existingVotingPower: g.existingVotingPower,
		})),
	});

	for (const {
		publicKey: enrollmentAddress,
		account: enrollment,
	} of enrollments) {
		try {
			const lock = await program.account.lock.fetch(enrollment.lock);
			const partnerPool = partnerTargets.get(lock.owner.toBase58());
			let forcedGauge;
			if (partnerPool) {
				const gaugeAddress = pda([
					Buffer.from("gauge"),
					protocolAddress.toBuffer(),
					new PublicKey(partnerPool).toBuffer(),
				]);
				const gauge = await program.account.gauge.fetchNullable(gaugeAddress);
				// The program only accepts votes for an active gauge. Until the partner's is active
				// the lock is left alone rather than voted for someone else's.
				if (!gauge || gauge.status !== 2) {
					log("lock_processed", {
						lock: enrollment.lock.toBase58(),
						owner: lock.owner.toBase58(),
						status: "partner_gauge_inactive",
						pool: partnerPool,
					});
					continue;
				}
				forcedGauge = gaugeAddress;
			}
			const result = await voteForEnrollment({
				enrollmentAddress,
				lockAddress: enrollment.lock,
				lock,
				protocolAddress,
				epochAddress,
				currentEpoch,
				rankedGauges,
				forcedGauge,
			});
			log("lock_processed", {
				partnerGauge: forcedGauge ? forcedGauge.toBase58() : undefined,
				lock: enrollment.lock.toBase58(),
				owner: lock.owner.toBase58(),
				veTokenId: lock.veTokenId.toNumber(),
				...result,
			});
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			log("lock_failed", { lock: enrollment.lock.toBase58(), error: message });
		}
	}
};

await run();
