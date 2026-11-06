import {
	AnchorProvider,
	type Idl,
	Program,
	type Wallet,
} from "@coral-xyz/anchor";
import type { Connection } from "@solana/web3.js";
import type { Vesolve } from "./artifacts/vesolve";
import VesolveIDL from "./artifacts/vesolve.json";

export class VeContext {
	readonly connection: Connection;
	readonly wallet: Wallet;
	readonly program: Program<Vesolve>;
	readonly provider: AnchorProvider;

	constructor(
		connection: Connection,
		wallet: Wallet,
		program: Program,
		provider: AnchorProvider,
	) {
		this.connection = connection;
		this.wallet = wallet;
		this.program = program as unknown as Program<Vesolve>;
		this.provider = provider;
	}

	static create(connection: Connection, wallet: Wallet): VeContext {
		const anchorProvide = new AnchorProvider(connection, wallet, {
			commitment: "confirmed",
			preflightCommitment: "confirmed",
		});

		const program = new Program(VesolveIDL as Idl, anchorProvide);
		return new VeContext(connection, wallet, program, anchorProvide);
	}
}
