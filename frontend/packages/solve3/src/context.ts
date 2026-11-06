import { AnchorProvider, Program, type Wallet } from "@coral-xyz/anchor";
import type { Connection } from "@solana/web3.js";
import type { Solve3 } from "./artifacts/solve3";
import { VE_PROGRAM_INTERFACE } from "./constants/configs";

export class VeContext {
	readonly connection: Connection;
	readonly wallet: Wallet;
	readonly program: Program<Solve3>;
	readonly provider: AnchorProvider;

	constructor(
		connection: Connection,
		wallet: Wallet,
		program: Program<Solve3>,
		provider: AnchorProvider,
	) {
		this.connection = connection;
		this.wallet = wallet;
		this.program = program;
		this.provider = provider;
	}

	static create(connection: Connection, wallet: Wallet): VeContext {
		const anchorProvide = new AnchorProvider(connection, wallet, {
			commitment: "confirmed",
			preflightCommitment: "confirmed",
		});

		const program = new Program<Solve3>(VE_PROGRAM_INTERFACE, anchorProvide);
		return new VeContext(connection, wallet, program, anchorProvide);
	}
}
