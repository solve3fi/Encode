import type { VeContext } from "./context";

export interface IVeClient {
	getContext: () => VeContext;
}

export class VeClient implements IVeClient {
	private readonly ctx: VeContext;

	constructor(ctx: VeContext) {
		this.ctx = ctx;
	}

	getContext(): VeContext {
		return this.ctx;
	}
}

export const buildClient = (ctx: VeContext): VeClient => {
	return new VeClient(ctx);
};
