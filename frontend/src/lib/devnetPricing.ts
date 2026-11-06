import Decimal from "decimal.js";

export interface PricingPool {
	address: string;
	mintA: string;
	mintB: string;
	decimalsA: number;
	decimalsB: number;
	sqrtPrice: string;
	liquidity: string;
	amountA: string;
	amountB: string;
}

// Devnet display estimates, not an oracle or executable swap quote. Anchor
// only the configured test stablecoin, then follow funded pool spot prices.
// Prefer the path with the largest bottleneck USD reserve; never let a cycle
// reprice the anchor or let an empty, merely initialized pool invent a price.
export function deriveDevnetPrices(pools: PricingPool[], stableMint: string) {
	const prices = new Map<string, Decimal>([[stableMint, new Decimal(1)]]);
	const depth = new Map<string, Decimal>([[stableMint, new Decimal(Infinity)]]);
	const edges = pools.flatMap((pool) => {
		const sqrt = new Decimal(pool.sqrtPrice);
		const a = new Decimal(pool.amountA).div(new Decimal(10).pow(pool.decimalsA));
		const b = new Decimal(pool.amountB).div(new Decimal(10).pow(pool.decimalsB));
		const ratio = sqrt.div(new Decimal(2).pow(64)).pow(2)
			.mul(new Decimal(10).pow(pool.decimalsA - pool.decimalsB));
		if (!new Decimal(pool.liquidity).gt(0) || !a.gt(0) || !b.gt(0) ||
			!ratio.isFinite() || !ratio.gt(0) || pool.mintA === pool.mintB) return [];
		return [
			{ from: pool.mintB, to: pool.mintA, multiplier: ratio, reserve: Decimal.min(b, a.mul(ratio)), id: pool.address },
			{ from: pool.mintA, to: pool.mintB, multiplier: new Decimal(1).div(ratio), reserve: Decimal.min(a, b.div(ratio)), id: pool.address },
		];
	}).sort((a, b) => a.id.localeCompare(b.id));
	while (true) {
		let best: { mint: string; price: Decimal; depth: Decimal } | undefined;
		for (const edge of edges) {
			const sourcePrice = prices.get(edge.from);
			if (!sourcePrice || prices.has(edge.to)) continue;
			const candidateDepth = Decimal.min(depth.get(edge.from)!, edge.reserve.mul(sourcePrice));
			const price = sourcePrice.mul(edge.multiplier);
			if (!price.isFinite() || !price.gt(0)) continue;
			if (!best || candidateDepth.gt(best.depth)) best = { mint: edge.to, price, depth: candidateDepth };
		}
		if (!best) break;
		prices.set(best.mint, best.price);
		depth.set(best.mint, best.depth);
	}
	return prices;
}

export function valueTokenAmounts(amounts: Record<string, number>, prices: ReadonlyMap<string, Decimal>) {
	let total = new Decimal(0);
	let isComplete = true;
	for (const [mint, amount] of Object.entries(amounts)) {
		if (!Number.isFinite(amount) || amount < 0) { isComplete = false; continue; }
		if (amount === 0) continue;
		const price = prices.get(mint);
		if (!price?.isFinite() || !price.gt(0)) { isComplete = false; continue; }
		total = total.add(price.mul(amount));
	}
	return { total, isComplete };
}
