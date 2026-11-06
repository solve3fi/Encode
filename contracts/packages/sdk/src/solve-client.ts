import type { Address } from "@coral-xyz/anchor";
import type { Instruction } from "@solvefi/common";
import { AddressUtil } from "@solvefi/common";
import type BN from "bn.js";
import { VeClient } from "./client";
import { initializeProtocol } from "./instructions/initialize";
import { getProtocolPDA } from "./utils/pda";
import { Protocol } from "./utils/protocol";

export class SolveClient extends VeClient {
	async initProtocol(
		sourceWallet?: Address,
		mintToken?: Address,
		epochResetTime?: BN,
	): Promise<Instruction> {
		const funder = sourceWallet
			? AddressUtil.toPubKey(sourceWallet)
			: this.getContext().wallet.publicKey;

		const [protocolPDA] = getProtocolPDA(this.getContext().program.programId);
		if (protocolPDA) throw new Error("Protocol already initialized");
		if (!mintToken) throw new Error("Mint token is required");
		if (!epochResetTime) throw new Error("Epoch reset time is required");

		return initializeProtocol(this.getContext().program, {
			protocolAddress: protocolPDA,
			mintToken: AddressUtil.toPubKey(mintToken),
			epochResetTime,
			funder,
		});
	}

	async getProtocol(protocolAddress: Address): Promise<Protocol> {
		const program = this.getContext().program;
		const account = await program.account.protocol.fetch(protocolAddress);
		if (!account) throw new Error("Protocol not found");
		return new Protocol(
			this.getContext(),
			AddressUtil.toPubKey(protocolAddress),
			account,
		);
	}
}
