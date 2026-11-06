import {
  resolveOrCreateATAs,
  TransactionBuilder,
  U64_MAX,
  ZERO,
} from "@solve3fi/common";
import type { PublicKey } from "@solana/web3.js";
import type { Solve, SolveContext } from "../..";
import { SwapUtils } from "../..";
import type { SolveAccountFetchOptions } from "../../network/public/fetcher";
import type { SwapInput } from "../swap-ix";
import { swapIx } from "../swap-ix";
import { TokenExtensionUtil } from "../../utils/public/token-extension-util";
import { swapV2Ix } from "../v2";
import { NATIVE_MINT } from "@solana/spl-token";

export type SwapAsyncParams = {
  swapInput: SwapInput;
  solve: Solve;
  wallet: PublicKey;
};

/**
 * Swap instruction builder method with resolveATA & additional checks.
 * @param ctx - SolveContext object for the current environment.
 * @param params - {@link SwapAsyncParams}
 * @param opts - {@link SolveAccountFetchOptions} to use for account fetching.
 * @returns
 */
export async function swapAsync(
  ctx: SolveContext,
  params: SwapAsyncParams,
  _opts: SolveAccountFetchOptions,
): Promise<TransactionBuilder> {
  const { wallet, solve, swapInput } = params;
  const { aToB, amount, otherAmountThreshold, amountSpecifiedIsInput } =
    swapInput;
  const txBuilder = new TransactionBuilder(
    ctx.connection,
    ctx.wallet,
    ctx.txBuilderOpts,
  );

  // No need to check if TickArrays are initialized after SparseSwap implementation

  const data = solve.getData();

  // In ExactOut mode, max input amount is otherAmountThreshold
  const inputTokenMint = aToB ? data.tokenMintA : data.tokenMintB;
  const maxInputAmount = amountSpecifiedIsInput ? amount : otherAmountThreshold;
  if (inputTokenMint.equals(NATIVE_MINT) && maxInputAmount.eq(U64_MAX)) {
    // Strictly speaking, the upper limit would be the wallet balance minus rent and fees,
    // but that calculation is impractical.
    // Since this function is called to perform a transaction, we can expect the otherAmountThreshold
    // to be smaller than the wallet balance, and a run-time error would make the problem clear at worst.
    // Here, the obviously impossible case (a value using defaultOtherAmountThreshold) will be an error.
    throw new Error("Wrapping U64_MAX amount of SOL is not possible");
  }

  const [resolvedAtaA, resolvedAtaB] = await resolveOrCreateATAs(
    ctx.connection,
    wallet,
    [
      {
        tokenMint: data.tokenMintA,
        wrappedSolAmountIn: aToB ? maxInputAmount : ZERO,
      },
      {
        tokenMint: data.tokenMintB,
        wrappedSolAmountIn: !aToB ? maxInputAmount : ZERO,
      },
    ],
    () => ctx.fetcher.getAccountRentExempt(),
    undefined, // use default
    true, // use idempotent to allow multiple simultaneous calls
    ctx.accountResolverOpts.allowPDAOwnerAddress,
    ctx.accountResolverOpts.createWrappedSolAccountMethod,
  );
  const { address: ataAKey, ...tokenOwnerAccountAIx } = resolvedAtaA;
  const { address: ataBKey, ...tokenOwnerAccountBIx } = resolvedAtaB;
  txBuilder.addInstructions([tokenOwnerAccountAIx, tokenOwnerAccountBIx]);
  const inputTokenAccount = aToB ? ataAKey : ataBKey;
  const outputTokenAccount = aToB ? ataBKey : ataAKey;

  const tokenExtensionCtx = await TokenExtensionUtil.buildTokenExtensionContext(
    ctx.fetcher,
    data,
  );

  const baseParams = SwapUtils.getSwapParamsFromQuote(
    swapInput,
    ctx,
    solve,
    inputTokenAccount,
    outputTokenAccount,
    wallet,
  );
  return txBuilder.addInstruction(
    !TokenExtensionUtil.isV2IxRequiredPool(tokenExtensionCtx) &&
      !params.swapInput.supplementalTickArrays
      ? swapIx(ctx.program, baseParams)
      : swapV2Ix(ctx.program, {
          ...baseParams,
          tokenMintA: tokenExtensionCtx.tokenMintWithProgramA.address,
          tokenMintB: tokenExtensionCtx.tokenMintWithProgramB.address,
          tokenProgramA: tokenExtensionCtx.tokenMintWithProgramA.tokenProgram,
          tokenProgramB: tokenExtensionCtx.tokenMintWithProgramB.tokenProgram,
          ...(await TokenExtensionUtil.getExtraAccountMetasForTransferHookForPool(
            ctx.connection,
            tokenExtensionCtx,
            baseParams.aToB
              ? baseParams.tokenOwnerAccountA
              : baseParams.tokenVaultA,
            baseParams.aToB
              ? baseParams.tokenVaultA
              : baseParams.tokenOwnerAccountA,
            baseParams.aToB ? baseParams.tokenAuthority : baseParams.solve,
            baseParams.aToB
              ? baseParams.tokenVaultB
              : baseParams.tokenOwnerAccountB,
            baseParams.aToB
              ? baseParams.tokenOwnerAccountB
              : baseParams.tokenVaultB,
            baseParams.aToB ? baseParams.solve : baseParams.tokenAuthority,
          )),
          supplementalTickArrays: params.swapInput.supplementalTickArrays,
        }),
  );
}
