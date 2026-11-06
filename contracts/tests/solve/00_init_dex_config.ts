import * as anchor from "@coral-xyz/anchor";
import {
	IGNORE_CACHE,
	type InitConfigParams,
	SolveContext,
	SolveIx,
	toTx,
} from "@solvefi/sdk";
import {
	DEFAULT_PROTOCOL_FEE_RATE,
	PROTOCOL_FEE_AUTHORITY,
} from "../configs/solve";
import { delay } from "../utils/delay";

describe("Dex Deploy", () => {
	anchor.setProvider(anchor.AnchorProvider.env());
	const provider = anchor.getProvider();
	const wallet = provider.publicKey;
	const ctx = SolveContext.withProvider(provider as anchor.AnchorProvider);

	it("Creates a new Dex", async () => {
		const configKeyPair = anchor.web3.Keypair.generate();
		const initializedConfigInfo: InitConfigParams = {
			solvesConfigKeypair: configKeyPair,
			collectProtocolFeesAuthority: new anchor.web3.PublicKey(
				PROTOCOL_FEE_AUTHORITY,
			),
			defaultProtocolFeeRate: DEFAULT_PROTOCOL_FEE_RATE,
			feeAuthority: wallet,
			rewardEmissionsSuperAuthority: wallet,
			funder: wallet,
		};

		const tx = toTx(
			ctx,
			SolveIx.initializeConfigIx(ctx.program, initializedConfigInfo),
		);
		const txid = await tx.buildAndExecute();
		console.log("dex pool config deployed at txid:", txid);

		const CONFIG_WALLET =
			initializedConfigInfo.solvesConfigKeypair.publicKey.toBase58();

		console.log("CONFIG_WALLET:", CONFIG_WALLET);
		await delay(5000);

		const configAccount = await ctx.fetcher.getConfig(
			CONFIG_WALLET,
			IGNORE_CACHE,
		);

		console.log("===================================================");
		console.log("ReDEX Pool Config Info:");
		console.log(`public_key: ${CONFIG_WALLET}`);
		console.log("fee_authority:", configAccount?.feeAuthority.toBase58());
		console.log(
			"collect_protocol_fees_authority:",
			configAccount?.collectProtocolFeesAuthority.toBase58(),
		);
		console.log(
			"reward_emissions_super_authority:",
			configAccount?.rewardEmissionsSuperAuthority.toBase58(),
		);

		console.log(
			"default_protocol_fee_rate:",
			configAccount?.defaultProtocolFeeRate.toString(),
		);
		console.log("===================================================");
	});
});
