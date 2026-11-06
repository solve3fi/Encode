import type { PublicKey } from "@solana/web3.js";
import type { VeContext } from "./context";

export interface IVeClient {
	getContext(): VeContext;
}

export interface IProtocol {
	getAddress(): PublicKey;
}

export class VeClient implements IVeClient {
	private readonly context: VeContext;

	constructor(context: VeContext) {
		this.context = context;
	}

	getContext(): VeContext {
		return this.context;
	}
}

export const buildClient = (ctx: VeContext): VeClient => {
	return new VeClient(ctx);
};
