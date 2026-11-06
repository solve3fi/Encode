import type { PublicKey } from "@solana/web3.js";
import type BN from "bn.js";
import type { IProtocol } from "../client";
import type { VeContext } from "../context";

export type ProtocolData = {
	admin: PublicKey;
	tokenMint: PublicKey;
	nextNftTokenId: BN;
	totalSupply: BN;
	totalLocked: BN;
	currentEpoch: BN;
	lastEmissionTime: BN;
	epochStartTime: BN;
	epochResetTime: BN;
};

export class Protocol implements IProtocol {
	private data: ProtocolData;

	constructor(
		readonly ctx: VeContext,
		readonly address: PublicKey,
		data: ProtocolData,
	) {
		this.data = data;
	}

	getData(): ProtocolData {
		return this.data;
	}

	getAddress(): PublicKey {
		return this.address;
	}
}
