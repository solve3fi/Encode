import type { Address } from "anchor-legacy";
import type { Instruction } from "@solve3fi/common";
import {
  AddressUtil,
  TokenUtil,
  TransactionBuilder,
} from "@solve3fi/common";
import { NATIVE_MINT } from "@solana/spl-token";
import { PACKET_DATA_SIZE } from "@solana/web3.js";
import type { SolveContext } from "../..";
import { PREFER_CACHE } from "../../network/public/fetcher";
import {
  TokenMintTypes,
  addNativeMintHandlingIx,
  getTokenMintsFromSolves,
  resolveAtaForMints,
} from "../../utils/solve-ata-utils";
import { collectProtocolFeesIx } from "../collect-protocol-fees-ix";
import { TokenExtensionUtil } from "../../utils/public/token-extension-util";
import { collectProtocolFeesV2Ix } from "../v2";

export async function collectProtocolFees(
  ctx: SolveContext,
  poolAddresses: Address[],
): Promise<TransactionBuilder> {
  const receiverKey = ctx.wallet.publicKey;
  const payerKey = ctx.wallet.publicKey;

  const solveDatas = Array.from(
    (await ctx.fetcher.getPools(poolAddresses, PREFER_CACHE)).values(),
  );

  // make cache
  const mints = getTokenMintsFromSolves(
    solveDatas,
    TokenMintTypes.POOL_ONLY,
  ).mintMap;
  await ctx.fetcher.getMintInfos(mints);

  const accountExemption = await ctx.fetcher.getAccountRentExempt();
  const { ataTokenAddresses, resolveAtaIxs } = await resolveAtaForMints(ctx, {
    mints: mints,
    accountExemption,
    receiver: receiverKey,
    payer: payerKey,
  });

  const latestBlockhash = await ctx.connection.getLatestBlockhash();
  let txBuilder = new TransactionBuilder(
    ctx.connection,
    ctx.wallet,
    ctx.txBuilderOpts,
  ).addInstructions(resolveAtaIxs);

  const instructions: Instruction[] = [];

  for (const poolAddress of poolAddresses) {
    const pool = await ctx.fetcher.getPool(poolAddress);
    if (!pool) {
      throw new Error(`Pool not found: ${poolAddress}`);
    }

    const poolConfig = await ctx.fetcher.getConfig(pool.solvesConfig);
    if (!poolConfig) {
      throw new Error(`Config not found: ${pool.solvesConfig}`);
    }

    if (
      poolConfig.collectProtocolFeesAuthority.toBase58() !==
      ctx.wallet.publicKey.toBase58()
    ) {
      throw new Error(`Wallet is not the collectProtocolFeesAuthority`);
    }

    const poolHandlesNativeMint =
      TokenUtil.isNativeMint(pool.tokenMintA) ||
      TokenUtil.isNativeMint(pool.tokenMintB);
    const txBuilderHasNativeMint = !!ataTokenAddresses[NATIVE_MINT.toBase58()];

    if (poolHandlesNativeMint && !txBuilderHasNativeMint) {
      addNativeMintHandlingIx(
        txBuilder,
        ataTokenAddresses,
        receiverKey,
        accountExemption,
        ctx.accountResolverOpts.createWrappedSolAccountMethod,
      );
    }

    const tokenExtensionCtx =
      await TokenExtensionUtil.buildTokenExtensionContext(
        ctx.fetcher,
        pool,
        PREFER_CACHE,
      );

    const baseParams = {
      solvesConfig: pool.solvesConfig,
      solve: AddressUtil.toPubKey(poolAddress),
      tokenVaultA: pool.tokenVaultA,
      tokenVaultB: pool.tokenVaultB,
      tokenOwnerAccountA: ataTokenAddresses[pool.tokenMintA.toBase58()],
      tokenOwnerAccountB: ataTokenAddresses[pool.tokenMintB.toBase58()],
      collectProtocolFeesAuthority: poolConfig.collectProtocolFeesAuthority,
    };

    // add collect ixn
    instructions.push(
      !TokenExtensionUtil.isV2IxRequiredPool(tokenExtensionCtx)
        ? collectProtocolFeesIx(ctx.program, baseParams)
        : collectProtocolFeesV2Ix(ctx.program, {
            ...baseParams,
            tokenMintA: tokenExtensionCtx.tokenMintWithProgramA.address,
            tokenMintB: tokenExtensionCtx.tokenMintWithProgramB.address,
            tokenProgramA: tokenExtensionCtx.tokenMintWithProgramA.tokenProgram,
            tokenProgramB: tokenExtensionCtx.tokenMintWithProgramB.tokenProgram,
            ...(await TokenExtensionUtil.getExtraAccountMetasForTransferHookForPool(
              ctx.connection,
              tokenExtensionCtx,
              baseParams.tokenVaultA,
              baseParams.tokenOwnerAccountA,
              baseParams.solve, // vault to protocol, so pool is authority
              baseParams.tokenVaultB,
              baseParams.tokenOwnerAccountB,
              baseParams.solve, // vault to protocol, so pool is authority
            )),
          }),
    );
  }

  txBuilder.addInstructions(instructions);
  const txSize = await txBuilder.txnSize({ latestBlockhash });
  if (txSize > PACKET_DATA_SIZE) {
    throw new Error(`Transaction size is too large: ${txSize}`);
  }

  return txBuilder;
}
