import * as anchor from "@coral-xyz/anchor";
import {
	type FeeTierData,
	IGNORE_CACHE,
	type InitFeeTierParams,
	PDAUtil,
	SolveContext,
	SolveIx,
	toTx,
} from "@solvefi/sdk";
import { FEE_TIERS, PROGRAM_CONFIG } from "../configs/solve";

describe("Dex Fee Tiers", () => {
	anchor.setProvider(anchor.AnchorProvider.env());
	const provider = anchor.getProvider();
	const ctx = SolveContext.withProvider(provider as anchor.AnchorProvider);

	it("Init fee tiers", async () => {
		const configAccount = await ctx.fetcher.getConfig(PROGRAM_CONFIG);
		if (configAccount) {
			for (let i = 0; i < FEE_TIERS.length; i++) {
				const feeTier = FEE_TIERS[i];
				const feeTierPda = PDAUtil.getFeeTier(
					ctx.program.programId,
					new anchor.web3.PublicKey(PROGRAM_CONFIG),
					feeTier.tickSpacing,
				);

				let feeTierAccount = (await ctx.fetcher.getFeeTier(
					feeTierPda.publicKey,
				)) as FeeTierData;

				if (feeTierAccount) {
					console.log("public_key:", feeTierPda.publicKey.toBase58());
					console.log("tick_spacing:", feeTierAccount.tickSpacing);
					continue;
				}
				console.log("------------");
				console.log("deploying fee tier account...");
				const params: InitFeeTierParams = {
					solvesConfig: new anchor.web3.PublicKey(PROGRAM_CONFIG),
					feeTierPda,
					tickSpacing: feeTier.tickSpacing,
					defaultFeeRate: feeTier.fee,
					feeAuthority: configAccount.feeAuthority,
					funder: ctx.wallet.publicKey,
				};
				const tx = toTx(ctx, SolveIx.initializeFeeTierIx(ctx.program, params));

				const txid = await tx.buildAndExecute();
				console.log("fee tier account deployed at txid:", txid);
				feeTierAccount = (await ctx.fetcher.getFeeTier(
					feeTierPda.publicKey,
					IGNORE_CACHE,
				)) as FeeTierData;

				console.log("===================================================");
				console.log("Fee Tier Account Info:");
				console.log("public_key:", feeTierPda.publicKey.toBase58());
				console.log("tick_spacing:", feeTierAccount.tickSpacing);
				console.log(
					`default_fee_rate: ${(feeTierAccount.defaultFeeRate / 10000) * 100}%`,
				);
			}
		}
	});
});
