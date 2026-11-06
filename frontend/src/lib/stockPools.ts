import type { StockAsset } from "../configs/stockAssets";

type PoolMints = {
	getData(): {
		tokenMintA: { toString(): string };
		tokenMintB: { toString(): string };
	};
};

export function filterStockPools<T extends PoolMints>(
	pools: readonly T[] | undefined,
	chainId: number,
	assets: readonly StockAsset[],
): T[] {
	const mints = new Set(assets.filter((asset) => asset.chainId === chainId).map((asset) => asset.mint));
	return (pools ?? []).filter((pool) => {
		const data = pool.getData();
		return mints.has(data.tokenMintA.toString()) || mints.has(data.tokenMintB.toString());
	});
}
