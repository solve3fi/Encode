import { type Idl, Program } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import type BN from "bn.js";
import { useMemo } from "react";
import { VESOLVE_IDL } from "@/configs/vesolveIdl";
import { useAnchor } from "@/providers/DappProvider";

// Raw, camelCased decoded shapes for vesolve's on-chain accounts — mirrors
// programs/vesolve/src/states/*.rs in ve33-contracts exactly. Named "Raw"
// to distinguish from the UI-facing shapes hooks like useLocks/useLockData
// map these into (which follow the pre-existing @solve33/common-derived
// field names the Lock/Vote components were written against).
export type RawGaugeWeight = { gauge: PublicKey; weight: BN; votes: BN };
export type RawBribeWeight = {
	gauge: PublicKey;
	tokenMint: PublicKey;
	amount: BN;
};
export type RawGaugeVote = { gauge: PublicKey; weight: BN };

export type RawProtocol = {
	admin: PublicKey;
	tokenMint: PublicKey;
	nextNftTokenId: BN;
	totalSupply: BN;
	totalLocked: BN;
	currentEpoch: BN;
	lastEmissionTime: BN;
	epochStartTime: BN;
	epochResetTime: BN;
	bump: number;
};

export type RawEpoch = {
	epoch: BN;
	startTime: BN;
	endTime: BN;
	totalVotingPower: BN;
	totalVotes: BN;
	gaugeWeights: RawGaugeWeight[];
	bribes: RawBribeWeight[];
	bump: number;
};

export type RawLock = {
	owner: PublicKey;
	veTokenId: BN;
	veMint: PublicKey;
	amount: BN;
	unlockTime: BN;
	votingPower: BN;
	lastVoteEpoch: BN;
	bump: number;
};

export type RawUserVote = {
	user: PublicKey;
	epoch: BN;
	totalVotingPower: BN;
	votes: RawGaugeVote[];
	lastVoteTime: BN;
	bump: number;
};

export type RawVoteLockRecord = {
	user: PublicKey;
	epoch: BN;
	lock: PublicKey;
	veTokenId: BN;
	bump: number;
};

export type RawGauge = {
	poolAddress: PublicKey;
	tokenMintA: PublicKey;
	tokenMintB: PublicKey;
	feeTier: number;
	isActive: boolean;
	bump: number;
	/** 0 created, 1 pending activation, 2 active, 3 pending removal, 4 removed */
	status: number;
	effectiveEpoch: BN;
	generation: number;
};

export type RawPairCanonical = {
	mintLo: PublicKey;
	mintHi: PublicKey;
	gauge: PublicKey;
	bump: number;
};

export type RawAllocationVoter = {
	lock: PublicKey;
	owner: PublicKey;
	bump: number;
	votes: RawGaugeVote[];
	version: number;
	appliedEpochPlusOne: BN;
	appliedVersion: number;
};

export type RawBribe = {
	gauge: PublicKey;
	tokenMint: PublicKey;
	creator: PublicKey;
	totalAmount: BN;
	bump: number;
};

export type RawVault = {
	admin: PublicKey;
	gauge: PublicKey;
	rewards: BN;
	poolRewardsA: BN;
	poolRewardsB: BN;
	epoch: BN;
	bump: number;
};

// Existence alone (not the stored amount) is what claim_reward/claim_bribe_reward
// treat as "already claimed" -- fetchNullable returning non-null is the check.
export type RawClaimedRewards = {
	user: PublicKey;
	gauge: PublicKey;
	epoch: BN;
	amount: BN;
	lastClaimTime: BN;
	bump: number;
};

export type RawClaimedPoolRewards = {
	user: PublicKey;
	gauge: PublicKey;
	epoch: BN;
	amountA: BN;
	amountB: BN;
	lastClaimTime: BN;
	bump: number;
	claimedA: boolean;
	claimedB: boolean;
};

// The weekly SOLV3 emission a gauge earns for its share of the vote — a
// Synthetix-style streaming reward funded once per epoch by fund_gauge_emission
// (programs/vesolve/src/instructions/fund_emission.rs), separate from RawVault
// above (which holds pool *trading fee* bribes, not token emissions).
export type RawGaugeReward = {
	gauge: PublicKey;
	rewardMint: PublicKey;
	totalWeight: BN;
	rewardRateX64: BN;
	rewardPerWeightX64: BN;
	lastUpdateTime: BN;
	periodFinish: BN;
	lastFundedEpoch: BN;
	bump: number;
};

export type RawEpochEmission = {
	epoch: BN;
	totalEmission: BN;
	gaugeBudget: BN;
	developerAllocation: BN;
	distributedToGauges: BN;
	developerWallet: PublicKey;
	bump: number;
};

export type RawNativeGauge = {
	gauge: PublicKey;
	pool: PublicKey;
	rewardVault: PublicKey;
	lastFundedEpoch: BN;
	rateX64: BN;
	periodFinish: BN;
	carryAmount: BN;
	bump: number;
};

export type RawExitConfig = {
	lamportsPerSolv3: BN;
	updatedAt: BN;
	updatedBy: PublicKey;
	bump: number;
};

export type RawAutoVoteEnrollment = {
	lock: PublicKey;
	owner: PublicKey;
	enrolledAt: BN;
	bump: number;
};

/** A wallet registered to auto-vote enrolled locks whose owners choose it (DEV-12). */
export type RawAutoVoter = {
	authority: PublicKey;
	registeredAt: BN;
	bump: number;
};

/** A voter wallet the Admin flagged as a partner: locks it votes pay no auto-vote fee. */
export type RawPartnerVoter = {
	voter: PublicKey;
	addedAt: BN;
	bump: number;
};

/** A lock owner's choice of auto-voter; counts only if set during the lock's current enrollment. */
export type RawAutoVoteDelegate = {
	lock: PublicKey;
	voter: PublicKey;
	setAt: BN;
	bump: number;
};

export type RawPoolFeeVault = {
	pool: PublicKey;
	tokenMintA: PublicKey;
	tokenMintB: PublicKey;
	totalWeight: BN;
	rewardPerWeightAX64: BN;
	rewardPerWeightBX64: BN;
	bump: number;
};

export type RawPoolFeePosition = {
	owner: PublicKey;
	pool: PublicKey;
	position: PublicKey;
	positionMint: PublicKey;
	weight: BN;
	rewardPerWeightAPaidX64: BN;
	rewardPerWeightBPaidX64: BN;
	accruedA: BN;
	accruedB: BN;
	lastFeeOwedA: BN;
	lastFeeOwedB: BN;
	isPaused: boolean;
	registeredAt: BN;
	bump: number;
};

export type RawExitFeeConfig = {
	feeBps: BN;
	pendingBps: BN;
	pendingEpoch: BN;
	bump: number;
};

type AccountClient<T> = {
	fetch: (address: PublicKey) => Promise<T>;
	fetchNullable: (address: PublicKey) => Promise<T | null>;
	fetchMultiple: (addresses: PublicKey[]) => Promise<(T | null)[]>;
	all: (
		filters?: { memcmp: { offset: number; bytes: string } }[],
	) => Promise<{ publicKey: PublicKey; account: T }[]>;
};

/**
 * Anchor's generic Idl type can't be satisfied by a hand-written IDL const
 * without exactly matching many nested literal types it wasn't designed to
 * be authored against by hand — so the Program itself is built with the
 * loose `Idl` type, and callers use these typed accessors instead of
 * `program.account.<name>` directly. The runtime decoding (discriminator +
 * borsh layout) is unaffected either way; only compile-time typing differs.
 */
export const vesolveAccount = {
	allocationVoter: (program: Program<Idl>) =>
		(
			program.account as unknown as Record<
				string,
				AccountClient<RawAllocationVoter>
			>
		).allocationVoter,
	pairCanonical: (program: Program<Idl>) =>
		(
			program.account as unknown as Record<
				string,
				AccountClient<RawPairCanonical>
			>
		).pairCanonical,
	nativeGauge: (program: Program<Idl>) =>
		(
			program.account as unknown as Record<
				string,
				AccountClient<RawNativeGauge>
			>
		).nativeGauge,
	exitFeeConfig: (program: Program<Idl>) =>
		(
			program.account as unknown as Record<
				string,
				AccountClient<RawExitFeeConfig>
			>
		).exitFeeConfig,
	protocol: (program: Program<Idl>) =>
		(program.account as unknown as Record<string, AccountClient<RawProtocol>>)
			.protocol,
	epoch: (program: Program<Idl>) =>
		(program.account as unknown as Record<string, AccountClient<RawEpoch>>)
			.epoch,
	lock: (program: Program<Idl>) =>
		(program.account as unknown as Record<string, AccountClient<RawLock>>).lock,
	userVote: (program: Program<Idl>) =>
		(program.account as unknown as Record<string, AccountClient<RawUserVote>>)
			.userVote,
	voteLockRecord: (program: Program<Idl>) =>
		(
			program.account as unknown as Record<
				string,
				AccountClient<RawVoteLockRecord>
			>
		).voteLockRecord,
	gauge: (program: Program<Idl>) =>
		(program.account as unknown as Record<string, AccountClient<RawGauge>>)
			.gauge,
	bribe: (program: Program<Idl>) =>
		(program.account as unknown as Record<string, AccountClient<RawBribe>>)
			.bribe,
	vault: (program: Program<Idl>) =>
		(program.account as unknown as Record<string, AccountClient<RawVault>>)
			.vaultData,
	gaugeReward: (program: Program<Idl>) =>
		(
			program.account as unknown as Record<
				string,
				AccountClient<RawGaugeReward>
			>
		).gaugeReward,
	epochEmission: (program: Program<Idl>) =>
		(
			program.account as unknown as Record<
				string,
				AccountClient<RawEpochEmission>
			>
		).epochEmission,
	exitConfig: (program: Program<Idl>) =>
		(program.account as unknown as Record<string, AccountClient<RawExitConfig>>)
			.exitConfig,
	autoVoteEnrollment: (program: Program<Idl>) =>
		(
			program.account as unknown as Record<
				string,
				AccountClient<RawAutoVoteEnrollment>
			>
		).autoVoteEnrollment,
	autoVoter: (program: Program<Idl>) =>
		(program.account as unknown as Record<string, AccountClient<RawAutoVoter>>)
			.autoVoter,
	partnerVoter: (program: Program<Idl>) =>
		(
			program.account as unknown as Record<
				string,
				AccountClient<RawPartnerVoter>
			>
		).partnerVoter,
	autoVoteDelegate: (program: Program<Idl>) =>
		(
			program.account as unknown as Record<
				string,
				AccountClient<RawAutoVoteDelegate>
			>
		).autoVoteDelegate,
	claimedRewards: (program: Program<Idl>) =>
		(
			program.account as unknown as Record<
				string,
				AccountClient<RawClaimedRewards>
			>
		).claimedRewards,
	claimedPoolRewards: (program: Program<Idl>) =>
		(
			program.account as unknown as Record<
				string,
				AccountClient<RawClaimedPoolRewards>
			>
		).claimedPoolRewards,
	poolFeeVault: (program: Program<Idl>) =>
		(
			program.account as unknown as Record<
				string,
				AccountClient<RawPoolFeeVault>
			>
		).poolFeeVault,
	poolFeePosition: (program: Program<Idl>) =>
		(
			program.account as unknown as Record<
				string,
				AccountClient<RawPoolFeePosition>
			>
		).poolFeePosition,
};

export const VESOLVE_PROGRAM_ID = new PublicKey(VESOLVE_IDL.address);

const PROTOCOL_SEED = Buffer.from("protocol");
const VE_LOCK_SEED = Buffer.from("ve_lock");
const GAUGE_SEED = Buffer.from("gauge");
const USER_VOTE_SEED = Buffer.from("user_vote");
const EPOCH_DATA_SEED = Buffer.from("epoch_data");
const VAULT_SEED = Buffer.from("vault");
const BRIBE_SEED = Buffer.from("bribe");
const GAUGE_REWARD_SEED = Buffer.from("gauge_reward");
const EPOCH_EMISSION_SEED = Buffer.from("epoch_emission");
const VE_TOKEN_SEED = Buffer.from("ve_token");
const EXIT_CONFIG_SEED = Buffer.from("exit_config");
const EXIT_FEE_CONFIG_SEED = Buffer.from("exit_fee_config");
const AUTO_VOTE_SEED = Buffer.from("auto_vote");
const USER_REWARDS_SEED = Buffer.from("user_rewards");
const USER_POOL_REWARDS_SEED = Buffer.from("user_pool_rewards");
const USER_BRIBE_REWARDS_SEED = Buffer.from("user_bribe_rewards");
const POOL_FEE_VAULT_SEED = Buffer.from("pool_fee_vault");
const POOL_FEE_POSITION_SEED = Buffer.from("pool_fee_position");
const VOTE_LOCK_SEED = Buffer.from("vote_lock");

export const METADATA_PROGRAM_ID = new PublicKey(
	"metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s",
);
// programs/vesolve/src/constants/ve.rs: WEEK = 7 * 24 * 60 * 60 seconds —
// the funding duration fund_gauge_emission uses to compute reward_rate_x64.
export const EMISSION_WEEK_SECONDS = 7 * 24 * 60 * 60;

// Avoids Buffer.prototype.writeBigUInt64LE: in the browser, "Buffer" is a
// bundler-injected polyfill, and different bundled copies (e.g. pulled in by
// different @coral-xyz/anchor versions) don't reliably expose that method —
// plain indexed byte writes work on every Buffer/Uint8Array implementation.
const u64LeBytes = (value: number | bigint): Buffer => {
	const buf = Buffer.alloc(8);
	let bn = BigInt(value);
	const eight = BigInt(8);
	for (let i = 0; i < 8; i++) {
		buf[i] = Number(bn & BigInt(0xff));
		bn >>= eight;
	}
	return buf;
};

export const getProtocolPDA = (): [PublicKey, number] =>
	PublicKey.findProgramAddressSync([PROTOCOL_SEED], VESOLVE_PROGRAM_ID);

export const getLockPDA = (veTokenId: number | bigint): [PublicKey, number] =>
	PublicKey.findProgramAddressSync(
		[VE_LOCK_SEED, u64LeBytes(veTokenId)],
		VESOLVE_PROGRAM_ID,
	);

export const getAllocationVoterPDA = (lock: PublicKey): [PublicKey, number] =>
	PublicKey.findProgramAddressSync(
		[Buffer.from("allocation"), lock.toBuffer()],
		VESOLVE_PROGRAM_ID,
	);

export const getEpochPDA = (epoch: number | bigint): [PublicKey, number] =>
	PublicKey.findProgramAddressSync(
		[EPOCH_DATA_SEED, u64LeBytes(epoch)],
		VESOLVE_PROGRAM_ID,
	);

/** A lock's vote for one epoch. Votes are per lock, not per wallet. */
export const getUserVotePDA = (
	lock: PublicKey,
	epoch: number | bigint,
): [PublicKey, number] =>
	PublicKey.findProgramAddressSync(
		[USER_VOTE_SEED, lock.toBuffer(), u64LeBytes(epoch)],
		VESOLVE_PROGRAM_ID,
	);

export const getVoteLockRecordPDA = (
	lock: PublicKey,
	epoch: number | bigint,
): [PublicKey, number] =>
	PublicKey.findProgramAddressSync(
		[VOTE_LOCK_SEED, lock.toBuffer(), u64LeBytes(epoch)],
		VESOLVE_PROGRAM_ID,
	);

export const getGaugePDA = (
	protocol: PublicKey,
	poolAddress: PublicKey,
): [PublicKey, number] =>
	PublicKey.findProgramAddressSync(
		[GAUGE_SEED, protocol.toBuffer(), poolAddress.toBuffer()],
		VESOLVE_PROGRAM_ID,
	);

export const getVaultPDA = (
	epoch: number | bigint,
	gauge: PublicKey,
): [PublicKey, number] =>
	PublicKey.findProgramAddressSync(
		[VAULT_SEED, u64LeBytes(epoch), gauge.toBuffer()],
		VESOLVE_PROGRAM_ID,
	);

export const getGaugeRewardPDA = (gauge: PublicKey): [PublicKey, number] =>
	PublicKey.findProgramAddressSync(
		[GAUGE_REWARD_SEED, gauge.toBuffer()],
		VESOLVE_PROGRAM_ID,
	);

export const getEpochEmissionPDA = (
	emissionEpoch: number | bigint,
): [PublicKey, number] =>
	PublicKey.findProgramAddressSync(
		[EPOCH_EMISSION_SEED, u64LeBytes(emissionEpoch)],
		VESOLVE_PROGRAM_ID,
	);

/** BribeToken whitelist entry for a mint (seeds ["bribe_token", mint]); required by claim_bribe_reward. */
export const getBribeTokenPDA = (mint: PublicKey): [PublicKey, number] =>
	PublicKey.findProgramAddressSync(
		[Buffer.from("bribe_token"), mint.toBuffer()],
		VESOLVE_PROGRAM_ID,
	);

export const getBribePDA = (
	gauge: PublicKey,
	tokenMint: PublicKey,
	user: PublicKey,
): [PublicKey, number] =>
	PublicKey.findProgramAddressSync(
		[BRIBE_SEED, gauge.toBuffer(), tokenMint.toBuffer(), user.toBuffer()],
		VESOLVE_PROGRAM_ID,
	);

/** The veNFT mint backing lock `veTokenId`. */
export const getVeMintPDA = (veTokenId: number | bigint): [PublicKey, number] =>
	PublicKey.findProgramAddressSync(
		[VE_TOKEN_SEED, u64LeBytes(veTokenId)],
		VESOLVE_PROGRAM_ID,
	);

/** Metaplex metadata for a veNFT mint. */
export const getMetadataPDA = (veMint: PublicKey): [PublicKey, number] =>
	PublicKey.findProgramAddressSync(
		[
			Buffer.from("metadata"),
			METADATA_PROGRAM_ID.toBuffer(),
			veMint.toBuffer(),
		],
		METADATA_PROGRAM_ID,
	);

/** Admin-published SOLV3 price the exit fee is charged against. */
export const getExitConfigPDA = (): [PublicKey, number] =>
	PublicKey.findProgramAddressSync([EXIT_CONFIG_SEED], VESOLVE_PROGRAM_ID);

/** Admin-set exit fee percentage; takes effect from the epoch after it is set. */
export const getExitFeeConfigPDA = (): [PublicKey, number] =>
	PublicKey.findProgramAddressSync([EXIT_FEE_CONFIG_SEED], VESOLVE_PROGRAM_ID);

/** Public Auto-Vote delegation record for a lock, if it's enrolled. */
export const getAutoVoteEnrollmentPDA = (
	lock: PublicKey,
): [PublicKey, number] =>
	PublicKey.findProgramAddressSync(
		[AUTO_VOTE_SEED, lock.toBuffer()],
		VESOLVE_PROGRAM_ID,
	);

export const getPartnerVoterPDA = (voter: PublicKey): [PublicKey, number] =>
	PublicKey.findProgramAddressSync(
		[Buffer.from("partner_voter"), voter.toBuffer()],
		VESOLVE_PROGRAM_ID,
	);

/** A wallet's auto-voter registration (DEV-12). */
export const getAutoVoterPDA = (authority: PublicKey): [PublicKey, number] =>
	PublicKey.findProgramAddressSync(
		[Buffer.from("auto_voter"), authority.toBuffer()],
		VESOLVE_PROGRAM_ID,
	);

/** A lock owner's chosen auto-voter for the lock (DEV-12). */
export const getAutoVoteDelegatePDA = (lock: PublicKey): [PublicKey, number] =>
	PublicKey.findProgramAddressSync(
		[Buffer.from("auto_vote_delegate"), lock.toBuffer()],
		VESOLVE_PROGRAM_ID,
	);

/** Whether `lock` has already claimed a gauge's SOLV3 emission for `epoch`. */
export const getUserRewardsPDA = (
	lock: PublicKey,
	epoch: PublicKey,
	gauge: PublicKey,
): [PublicKey, number] =>
	PublicKey.findProgramAddressSync(
		[USER_REWARDS_SEED, lock.toBuffer(), epoch.toBuffer(), gauge.toBuffer()],
		VESOLVE_PROGRAM_ID,
	);

/** Whether `lock` has already claimed a gauge's pooled trading fees for `epoch`. */
export const getUserPoolRewardsPDA = (
	lock: PublicKey,
	epoch: PublicKey,
	gauge: PublicKey,
): [PublicKey, number] =>
	PublicKey.findProgramAddressSync(
		[
			USER_POOL_REWARDS_SEED,
			lock.toBuffer(),
			epoch.toBuffer(),
			gauge.toBuffer(),
		],
		VESOLVE_PROGRAM_ID,
	);

/** Whether `lock` has already claimed one bribe token's payout for `epoch`. */
export const getUserBribeRewardsPDA = (
	lock: PublicKey,
	epoch: PublicKey,
	gauge: PublicKey,
	tokenMint: PublicKey,
): [PublicKey, number] =>
	PublicKey.findProgramAddressSync(
		[
			USER_BRIBE_REWARDS_SEED,
			lock.toBuffer(),
			epoch.toBuffer(),
			gauge.toBuffer(),
			tokenMint.toBuffer(),
		],
		VESOLVE_PROGRAM_ID,
	);

/** A pool's (Gauge-less) shared fee vault, seeded per pool address. */
export const getPoolFeeVaultPDA = (pool: PublicKey): [PublicKey, number] =>
	PublicKey.findProgramAddressSync(
		[POOL_FEE_VAULT_SEED, pool.toBuffer()],
		VESOLVE_PROGRAM_ID,
	);

/** An LP position's registration against its pool's fee vault, seeded per position mint. */
export const getPoolFeePositionPDA = (
	positionMint: PublicKey,
): [PublicKey, number] =>
	PublicKey.findProgramAddressSync(
		[POOL_FEE_POSITION_SEED, positionMint.toBuffer()],
		VESOLVE_PROGRAM_ID,
	);

/**
 * Anchor client for the vesolve program (ve(3,3) locks/vote/rewards).
 * Built from a hand-written IDL (see configs/vesolveIdl.ts) rather than
 * `useVeClient`, which targets an unrelated program — see the ve33-contracts
 * security-audit-fix branch for why. Use the vesolveAccount.* helpers above
 * for typed account access instead of program.account.<name> directly.
 */
export const useVesolveProgram = (): Program<Idl> => {
	const provider = useAnchor();

	return useMemo(
		() => new Program(VESOLVE_IDL as unknown as Idl, provider),
		[provider],
	);
};
