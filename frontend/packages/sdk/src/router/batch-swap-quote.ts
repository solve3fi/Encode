import type { Address } from "anchor-legacy";
import { AddressUtil } from "@solve3fi/common";
import type BN from "bn.js";
import invariant from "tiny-invariant";
import type {
  SolveAccountFetcherInterface,
  SolveAccountFetchOptions,
} from "../network/public/fetcher";
import type { SwapQuoteParam } from "../quotes/public";
import { PoolUtil, SwapDirection, SwapUtils } from "../utils/public";
import { NO_TOKEN_EXTENSION_CONTEXT } from "../utils/public/token-extension-util";

export interface SwapQuoteRequest {
  solve: Address;
  tradeTokenMint: Address;
  tokenAmount: BN;
  amountSpecifiedIsInput: boolean;
}

export async function batchBuildSwapQuoteParams(
  quoteRequests: SwapQuoteRequest[],
  programId: Address,
  fetcher: SolveAccountFetcherInterface,
  opts?: SolveAccountFetchOptions,
): Promise<SwapQuoteParam[]> {
  const solves = await fetcher.getPools(
    quoteRequests.map((req) => req.solve),
    opts,
  );
  const program = AddressUtil.toPubKey(programId);

  const tickArrayRequests = quoteRequests.map((quoteReq) => {
    const { solve, tokenAmount, tradeTokenMint, amountSpecifiedIsInput } =
      quoteReq;
    const solveData = solves.get(AddressUtil.toString(solve))!;
    const swapMintKey = AddressUtil.toPubKey(tradeTokenMint);
    const swapTokenType = PoolUtil.getTokenType(solveData, swapMintKey);
    invariant(
      !!swapTokenType,
      "swapTokenMint does not match any tokens on this pool",
    );
    const aToB =
      SwapUtils.getSwapDirection(
        solveData,
        swapMintKey,
        amountSpecifiedIsInput,
      ) === SwapDirection.AtoB;
    return {
      solveData,
      tokenAmount,
      aToB,
      tickCurrentIndex: solveData.tickCurrentIndex,
      tickSpacing: solveData.tickSpacing,
      solveAddress: AddressUtil.toPubKey(solve),
      amountSpecifiedIsInput,
    };
  });

  const tickArrays = await SwapUtils.getBatchTickArrays(
    program,
    fetcher,
    tickArrayRequests,
    opts,
  );

  return tickArrayRequests.map((req, index) => {
    const { solveData, tokenAmount, aToB, amountSpecifiedIsInput } = req;
    return {
      solveData,
      tokenAmount,
      aToB,
      amountSpecifiedIsInput,
      sqrtPriceLimit: SwapUtils.getDefaultSqrtPriceLimit(aToB),
      otherAmountThreshold: SwapUtils.getDefaultOtherAmountThreshold(
        amountSpecifiedIsInput,
      ),
      tickArrays: tickArrays[index],
      tokenExtensionCtx: NO_TOKEN_EXTENSION_CONTEXT, // SolveRouter does not support token extensions
    };
  });
}
