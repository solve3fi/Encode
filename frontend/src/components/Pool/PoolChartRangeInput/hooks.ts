// import type { TokenInfo } from '@solana/spl-token-registry'
// import { useMemo } from 'react'

// import type { ChartEntry } from './types'

export interface TickProcessed {
	tick: number;
	liquidityActive: bigint;
	liquidityNet: bigint;
	price0: string;
}

// interface UseDensityChartData {
//   chainId: number
//   token0: TokenInfo | undefined
//   token1: TokenInfo | undefined
//   feeAmount: number | undefined
//   enabled?: boolean
// }

// export function useDensityChartData({
//   chainId,
//   token0,
//   token1,
//   feeAmount,
//   enabled = true,
// }: UseDensityChartData) {
// const activeLiquidity = useConcentratedActiveLiquidity({
//   chainId,
//   token0,
//   token1,
//   feeAmount,
//   enabled,
// })
// return useMemo(() => {
//   const data = activeLiquidity.data
//   if (!data) return activeLiquidity
//   const newData: ChartEntry[] = []
//   for (let i = 0; i < data.length; i++) {
//     const t: TickProcessed = data[i]
//     const chartEntry = {
//       activeLiquidity: Number.parseFloat(t.liquidityActive.toString()),
//       price0: Number.parseFloat(t.price0),
//     }
//     if (chartEntry.activeLiquidity > 0) {
//       newData.push(chartEntry)
//     }
//   }
//   return {
//     ...activeLiquidity,
//     data: newData,
//   }
// }, [activeLiquidity])
// }
