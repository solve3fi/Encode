import {
	ASSOCIATED_TOKEN_PROGRAM_ID,
	getAssociatedTokenAddressSync,
	TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { PublicKey, SystemProgram } from "@solana/web3.js";

export function nativeGaugeAddresses(
	programId: PublicKey,
	dexProgramId: PublicKey,
	gauge: PublicKey,
	pool: PublicKey,
) {
	const derive = (seed: string, key: PublicKey, owner = programId) =>
		PublicKey.findProgramAddressSync(
			[Buffer.from(seed), key.toBuffer()],
			owner,
		)[0];
	return {
		nativeGauge: derive("native_gauge", gauge),
		legacyReward: derive("gauge_reward", gauge),
		rewardVault: derive("gauge_reward_vault", pool, dexProgramId),
	};
}

export function configureNativeGaugeAccounts({
	admin,
	protocol,
	gauge,
	pool,
	solvesConfig,
	tokenMintA,
	tokenMintB,
	rewardMint,
	programId,
	dexProgramId,
}: {
	admin: PublicKey;
	protocol: PublicKey;
	gauge: PublicKey;
	pool: PublicKey;
	solvesConfig: PublicKey;
	tokenMintA: PublicKey;
	tokenMintB: PublicKey;
	rewardMint: PublicKey;
	programId: PublicKey;
	dexProgramId: PublicKey;
}) {
	const addresses = nativeGaugeAddresses(programId, dexProgramId, gauge, pool);
	return {
		caller: admin,
		admin,
		protocol,
		gauge,
		pool,
		solvesConfig,
		tokenMintA,
		tokenMintB,
		rewardMint,
		...addresses,
		legacyVault: getAssociatedTokenAddressSync(
			rewardMint,
			addresses.legacyReward,
			true,
		),
		solveProgram: dexProgramId,
		tokenProgram: TOKEN_PROGRAM_ID,
		associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
		systemProgram: SystemProgram.programId,
	};
}
