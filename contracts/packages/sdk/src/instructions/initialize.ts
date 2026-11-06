import type { Program } from "@coral-xyz/anchor";
import { type PublicKey, SystemProgram } from "@solana/web3.js";
import type { Instruction } from "@solvefi/common";
import type BN from "bn.js";
import type { Vesolve } from "../artifacts/vesolve";

export type InitializeProtocolParams = {
	protocolAddress: PublicKey;
	mintToken: PublicKey;
	epochResetTime: BN;
	funder: PublicKey;
};

export const initializeProtocol = async (
	program: Program<Vesolve>,
	params: InitializeProtocolParams,
): Promise<Instruction> => {
	const { protocolAddress, mintToken, epochResetTime, funder } = params;

	const context = {
		payer: funder,
		protocol: protocolAddress,
		systemProgram: SystemProgram.programId,
	};

	const ix = await program.methods
		.initialize(mintToken, epochResetTime)
		.accounts(context)
		.instruction();

	return {
		instructions: [ix],
		cleanupInstructions: [],
		signers: [],
	};
};
