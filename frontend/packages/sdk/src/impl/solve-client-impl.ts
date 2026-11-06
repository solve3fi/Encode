import type { Address } from "anchor-legacy";
import { AddressUtil, TransactionBuilder } from "@solve3fi/common";
import { Keypair, PublicKey } from "@solana/web3.js";
import invariant from "tiny-invariant";
import type { SolveContext } from "../context";
import { initTickArrayIx } from "../instructions";
import {
  collectAllForPositionAddressesTxns,
  collectProtocolFees,
} from "../instructions/composites";
import { SolveIx } from "../ix";
import type {
  SolveAccountFetchOptions,
  SolveAccountFetcherInterface,
} from "../network/public/fetcher";
import { IGNORE_CACHE, PREFER_CACHE } from "../network/public/fetcher";
import type { SolveRouter } from "../router/public";
import { SolveRouterBuilder } from "../router/public";
import type { SolveData } from "../types/public";
import { SPLASH_POOL_TICK_SPACING } from "../types/public";
import { getTickArrayDataForPosition } from "../utils/builder/position-builder-util";
import { PDAUtil, PoolUtil, PriceMath, TickUtil } from "../utils/public";
import type { Position, Solve, SolveClient } from "../solve-client";
import { PositionImpl } from "./position-impl";
import {
  getRewardInfos,
  getTokenMintInfos,
  getTokenVaultAccountInfos,
} from "./util";
import { SolveImpl } from "./solve-impl";
import type { TokenExtensionContextForPool } from "../utils/public/token-extension-util";
import {
  NO_TOKEN_EXTENSION_CONTEXT,
  TokenExtensionUtil,
} from "../utils/public/token-extension-util";
import Decimal from "decimal.js";

export class SolveClientImpl implements SolveClient {
  constructor(readonly ctx: SolveContext) {}

  public getContext(): SolveContext {
    return this.ctx;
  }

  public getFetcher(): SolveAccountFetcherInterface {
    return this.ctx.fetcher;
  }

  public getRouter(poolAddresses: Address[]): Promise<SolveRouter> {
    return SolveRouterBuilder.buildWithPools(this.ctx, poolAddresses);
  }

  public async getPool(
    poolAddress: Address,
    opts = PREFER_CACHE,
  ): Promise<Solve> {
    const account = await this.ctx.fetcher.getPool(poolAddress, opts);
    if (!account) {
      throw new Error(`Unable to fetch Solve at address at ${poolAddress}`);
    }
    const tokenInfos = await getTokenMintInfos(this.ctx.fetcher, account, opts);
    const vaultInfos = await getTokenVaultAccountInfos(
      this.ctx.fetcher,
      account,
      opts,
    );
    const rewardInfos = await getRewardInfos(this.ctx.fetcher, account, opts);
    return new SolveImpl(
      this.ctx,
      AddressUtil.toPubKey(poolAddress),
      tokenInfos[0],
      tokenInfos[1],
      vaultInfos[0],
      vaultInfos[1],
      rewardInfos,
      account,
    );
  }

  public async getPools(
    poolAddresses: Address[],
    opts = PREFER_CACHE,
  ): Promise<Solve[]> {
    const accounts = Array.from(
      (await this.ctx.fetcher.getPools(poolAddresses, opts)).values(),
    ).filter((account): account is SolveData => !!account);
    if (accounts.length !== poolAddresses.length) {
      throw new Error(
        `Unable to fetch all Solves at addresses ${poolAddresses}`,
      );
    }
    const tokenMints = new Set<string>();
    const tokenAccounts = new Set<string>();
    accounts.forEach((account) => {
      tokenMints.add(account.tokenMintA.toBase58());
      tokenMints.add(account.tokenMintB.toBase58());
      tokenAccounts.add(account.tokenVaultA.toBase58());
      tokenAccounts.add(account.tokenVaultB.toBase58());
      account.rewardInfos.forEach((rewardInfo) => {
        if (PoolUtil.isRewardInitialized(rewardInfo)) {
          tokenAccounts.add(rewardInfo.vault.toBase58());
        }
      });
    });
    await this.ctx.fetcher.getMintInfos(Array.from(tokenMints), opts);
    await this.ctx.fetcher.getTokenInfos(Array.from(tokenAccounts), opts);

    const solves: Solve[] = [];
    for (let i = 0; i < accounts.length; i++) {
      const account = accounts[i];
      const poolAddress = poolAddresses[i];
      const tokenInfos = await getTokenMintInfos(
        this.ctx.fetcher,
        account,
        PREFER_CACHE,
      );
      const vaultInfos = await getTokenVaultAccountInfos(
        this.ctx.fetcher,
        account,
        PREFER_CACHE,
      );
      const rewardInfos = await getRewardInfos(
        this.ctx.fetcher,
        account,
        PREFER_CACHE,
      );
      solves.push(
        new SolveImpl(
          this.ctx,
          AddressUtil.toPubKey(poolAddress),
          tokenInfos[0],
          tokenInfos[1],
          vaultInfos[0],
          vaultInfos[1],
          rewardInfos,
          account,
        ),
      );
    }
    return solves;
  }

  public async getPosition(
    positionAddress: Address,
    opts = PREFER_CACHE,
  ): Promise<Position> {
    const account = await this.ctx.fetcher.getPosition(positionAddress, opts);
    if (!account) {
      throw new Error(
        `Unable to fetch Position at address at ${positionAddress}`,
      );
    }
    const whirlAccount = await this.ctx.fetcher.getPool(
      account.solve,
      opts,
    );
    if (!whirlAccount) {
      throw new Error(
        `Unable to fetch Solve for Position at address at ${positionAddress}`,
      );
    }

    const positionMint = await this.ctx.fetcher.getMintInfo(
      account.positionMint,
      opts,
    );
    if (!positionMint) {
      throw new Error(
        `Unable to fetch Mint for Position at address at ${positionAddress}`,
      );
    }

    const [lowerTickArray, upperTickArray] = await getTickArrayDataForPosition(
      this.ctx,
      account,
      whirlAccount,
      opts,
    );
    if (!lowerTickArray || !upperTickArray) {
      throw new Error(
        `Unable to fetch TickArrays for Position at address at ${positionAddress}`,
      );
    }
    return new PositionImpl(
      this.ctx,
      AddressUtil.toPubKey(positionAddress),
      account,
      whirlAccount,
      lowerTickArray,
      upperTickArray,
      positionMint.tokenProgram,
    );
  }

  public async getPositions(
    positionAddresses: Address[],
    opts = PREFER_CACHE,
  ): Promise<Record<string, Position | null>> {
    // TODO: Prefetch and use fetcher as a cache - Think of a cleaner way to prefetch
    const positions = Array.from(
      (await this.ctx.fetcher.getPositions(positionAddresses, opts)).values(),
    );
    const solveAddrs = positions
      .map((position) => position?.solve.toBase58())
      .flatMap((x) => (!!x ? x : []));
    await this.ctx.fetcher.getPools(solveAddrs, opts);
    const positionMintAddrs = positions
      .map((position) => position?.positionMint.toBase58())
      .flatMap((x) => (!!x ? x : []));
    await this.ctx.fetcher.getMintInfos(positionMintAddrs, opts);
    const tickArrayAddresses: Set<string> = new Set();
    await Promise.all(
      positions.map(async (pos) => {
        if (pos) {
          const pool = await this.ctx.fetcher.getPool(
            pos.solve,
            PREFER_CACHE,
          );
          if (pool) {
            const lowerTickArrayPda = PDAUtil.getTickArrayFromTickIndex(
              pos.tickLowerIndex,
              pool.tickSpacing,
              pos.solve,
              this.ctx.program.programId,
            ).publicKey;
            const upperTickArrayPda = PDAUtil.getTickArrayFromTickIndex(
              pos.tickUpperIndex,
              pool.tickSpacing,
              pos.solve,
              this.ctx.program.programId,
            ).publicKey;
            tickArrayAddresses.add(lowerTickArrayPda.toBase58());
            tickArrayAddresses.add(upperTickArrayPda.toBase58());
          }
        }
      }),
    );
    await this.ctx.fetcher.getTickArrays(
      Array.from(tickArrayAddresses),
      IGNORE_CACHE,
    );

    // Use getPosition and the prefetched values to generate the Positions
    const results = await Promise.all(
      positionAddresses.map(async (pos) => {
        try {
          const position = await this.getPosition(pos, PREFER_CACHE);
          return [pos, position];
        } catch {
          return [pos, null];
        }
      }),
    );
    return Object.fromEntries(results);
  }

  public async createSplashPool(
    solvesConfig: Address,
    tokenMintA: Address,
    tokenMintB: Address,
    initialPrice = new Decimal(1),
    funder: Address,
    opts = PREFER_CACHE,
  ): Promise<{ poolKey: PublicKey; tx: TransactionBuilder }> {
    const correctTokenOrder = PoolUtil.orderMints(tokenMintA, tokenMintB).map(
      (addr) => addr.toString(),
    );

    invariant(
      correctTokenOrder[0] === tokenMintA.toString(),
      "Token order needs to be flipped to match the canonical ordering (i.e. sorted on the byte repr. of the mint pubkeys)",
    );

    const mintInfos = await this.getFetcher().getMintInfos(
      [tokenMintA, tokenMintB],
      opts,
    );
    invariant(
      mintInfos.size === 2,
      "At least one of the token mints cannot be found.",
    );

    const tokenExtensionCtx: TokenExtensionContextForPool = {
      ...NO_TOKEN_EXTENSION_CONTEXT,
      tokenMintWithProgramA: mintInfos.get(tokenMintA.toString())!,
      tokenMintWithProgramB: mintInfos.get(tokenMintB.toString())!,
    };

    solvesConfig = AddressUtil.toPubKey(solvesConfig);

    const feeTierKey = PDAUtil.getFeeTier(
      this.ctx.program.programId,
      solvesConfig,
      SPLASH_POOL_TICK_SPACING,
    ).publicKey;

    const solvePda = PDAUtil.getSolve(
      this.ctx.program.programId,
      solvesConfig,
      new PublicKey(tokenMintA),
      new PublicKey(tokenMintB),
      SPLASH_POOL_TICK_SPACING,
    );

    const tokenDecimalsA = mintInfos.get(tokenMintA.toString())?.decimals ?? 0;
    const tokenDecimalsB = mintInfos.get(tokenMintB.toString())?.decimals ?? 0;
    const initSqrtPrice = PriceMath.priceToSqrtPriceX64(
      initialPrice,
      tokenDecimalsA,
      tokenDecimalsB,
    );
    const tokenVaultAKeypair = Keypair.generate();
    const tokenVaultBKeypair = Keypair.generate();

    const txBuilder = new TransactionBuilder(
      this.ctx.provider.connection,
      this.ctx.provider.wallet,
      this.ctx.txBuilderOpts,
    );

    const tokenBadgeA = PDAUtil.getTokenBadge(
      this.ctx.program.programId,
      solvesConfig,
      AddressUtil.toPubKey(tokenMintA),
    ).publicKey;
    const tokenBadgeB = PDAUtil.getTokenBadge(
      this.ctx.program.programId,
      solvesConfig,
      AddressUtil.toPubKey(tokenMintB),
    ).publicKey;

    const baseParams = {
      initSqrtPrice,
      solvesConfig,
      solvePda,
      tokenMintA: new PublicKey(tokenMintA),
      tokenMintB: new PublicKey(tokenMintB),
      tokenVaultAKeypair,
      tokenVaultBKeypair,
      feeTierKey,
      tickSpacing: SPLASH_POOL_TICK_SPACING,
      funder: new PublicKey(funder),
    };

    const initPoolIx = !TokenExtensionUtil.isV2IxRequiredPool(tokenExtensionCtx)
      ? SolveIx.initializePoolIx(this.ctx.program, baseParams)
      : SolveIx.initializePoolV2Ix(this.ctx.program, {
          ...baseParams,
          tokenProgramA: tokenExtensionCtx.tokenMintWithProgramA.tokenProgram,
          tokenProgramB: tokenExtensionCtx.tokenMintWithProgramB.tokenProgram,
          tokenBadgeA,
          tokenBadgeB,
        });

    txBuilder.addInstruction(initPoolIx);

    const [startTickIndex, endTickIndex] = TickUtil.getFullRangeTickIndex(
      SPLASH_POOL_TICK_SPACING,
    );
    const startInitializableTickIndex = TickUtil.getStartTickIndex(
      startTickIndex,
      SPLASH_POOL_TICK_SPACING,
    );
    const endInitializableTickIndex = TickUtil.getStartTickIndex(
      endTickIndex,
      SPLASH_POOL_TICK_SPACING,
    );

    const startTickArrayPda = PDAUtil.getTickArray(
      this.ctx.program.programId,
      solvePda.publicKey,
      startInitializableTickIndex,
    );

    const endTickArrayPda = PDAUtil.getTickArray(
      this.ctx.program.programId,
      solvePda.publicKey,
      endInitializableTickIndex,
    );

    txBuilder.addInstruction(
      initTickArrayIx(this.ctx.program, {
        startTick: startInitializableTickIndex,
        tickArrayPda: startTickArrayPda,
        solve: solvePda.publicKey,
        funder: AddressUtil.toPubKey(funder),
      }),
    );

    txBuilder.addInstruction(
      initTickArrayIx(this.ctx.program, {
        startTick: endInitializableTickIndex,
        tickArrayPda: endTickArrayPda,
        solve: solvePda.publicKey,
        funder: AddressUtil.toPubKey(funder),
      }),
    );

    return {
      poolKey: solvePda.publicKey,
      tx: txBuilder,
    };
  }

  public async createPool(
    solvesConfig: Address,
    tokenMintA: Address,
    tokenMintB: Address,
    tickSpacing: number,
    initialTick: number,
    funder: Address,
    opts = PREFER_CACHE,
  ): Promise<{ poolKey: PublicKey; tx: TransactionBuilder }> {
    invariant(
      TickUtil.checkTickInBounds(initialTick),
      "initialTick is out of bounds.",
    );
    invariant(
      TickUtil.isTickInitializable(initialTick, tickSpacing),
      `initial tick ${initialTick} is not an initializable tick for tick-spacing ${tickSpacing}`,
    );

    const correctTokenOrder = PoolUtil.orderMints(tokenMintA, tokenMintB).map(
      (addr) => addr.toString(),
    );

    invariant(
      correctTokenOrder[0] === tokenMintA.toString(),
      "Token order needs to be flipped to match the canonical ordering (i.e. sorted on the byte repr. of the mint pubkeys)",
    );

    const mintInfos = await this.ctx.fetcher.getMintInfos(
      [tokenMintA, tokenMintB],
      opts,
    );
    const tokenExtensionCtx: TokenExtensionContextForPool = {
      ...NO_TOKEN_EXTENSION_CONTEXT,
      tokenMintWithProgramA: mintInfos.get(tokenMintA.toString())!,
      tokenMintWithProgramB: mintInfos.get(tokenMintB.toString())!,
    };

    solvesConfig = AddressUtil.toPubKey(solvesConfig);

    const feeTierKey = PDAUtil.getFeeTier(
      this.ctx.program.programId,
      solvesConfig,
      tickSpacing,
    ).publicKey;

    const initSqrtPrice = PriceMath.tickIndexToSqrtPriceX64(initialTick);
    const tokenVaultAKeypair = Keypair.generate();
    const tokenVaultBKeypair = Keypair.generate();

    const solvePda = PDAUtil.getSolve(
      this.ctx.program.programId,
      solvesConfig,
      new PublicKey(tokenMintA),
      new PublicKey(tokenMintB),
      tickSpacing,
    );

    const feeTier = await this.ctx.fetcher.getFeeTier(feeTierKey, opts);
    invariant(!!feeTier, `Fee tier for ${tickSpacing} doesn't exist`);

    const txBuilder = new TransactionBuilder(
      this.ctx.provider.connection,
      this.ctx.provider.wallet,
      this.ctx.txBuilderOpts,
    );

    const tokenBadgeA = PDAUtil.getTokenBadge(
      this.ctx.program.programId,
      solvesConfig,
      AddressUtil.toPubKey(tokenMintA),
    ).publicKey;
    const tokenBadgeB = PDAUtil.getTokenBadge(
      this.ctx.program.programId,
      solvesConfig,
      AddressUtil.toPubKey(tokenMintB),
    ).publicKey;

    const baseParams = {
      initSqrtPrice,
      solvesConfig,
      solvePda,
      tokenMintA: new PublicKey(tokenMintA),
      tokenMintB: new PublicKey(tokenMintB),
      tokenVaultAKeypair,
      tokenVaultBKeypair,
      feeTierKey,
      tickSpacing,
      funder: new PublicKey(funder),
    };
    const initPoolIx = !TokenExtensionUtil.isV2IxRequiredPool(tokenExtensionCtx)
      ? SolveIx.initializePoolIx(this.ctx.program, baseParams)
      : SolveIx.initializePoolV2Ix(this.ctx.program, {
          ...baseParams,
          tokenProgramA: tokenExtensionCtx.tokenMintWithProgramA.tokenProgram,
          tokenProgramB: tokenExtensionCtx.tokenMintWithProgramB.tokenProgram,
          tokenBadgeA,
          tokenBadgeB,
        });

    const initialTickArrayStartTick = TickUtil.getStartTickIndex(
      initialTick,
      tickSpacing,
    );
    const initialTickArrayPda = PDAUtil.getTickArray(
      this.ctx.program.programId,
      solvePda.publicKey,
      initialTickArrayStartTick,
    );

    txBuilder.addInstruction(initPoolIx);
    txBuilder.addInstruction(
      initTickArrayIx(this.ctx.program, {
        startTick: initialTickArrayStartTick,
        tickArrayPda: initialTickArrayPda,
        solve: solvePda.publicKey,
        funder: AddressUtil.toPubKey(funder),
      }),
    );

    return {
      poolKey: solvePda.publicKey,
      tx: txBuilder,
    };
  }

  public async collectFeesAndRewardsForPositions(
    positionAddresses: Address[],
    opts?: SolveAccountFetchOptions,
  ): Promise<TransactionBuilder[]> {
    const walletKey = this.ctx.wallet.publicKey;
    return collectAllForPositionAddressesTxns(
      this.ctx,
      {
        positions: positionAddresses,
        receiver: walletKey,
        positionAuthority: walletKey,
        positionOwner: walletKey,
        payer: walletKey,
      },
      opts,
    );
  }

  public async collectProtocolFeesForPools(
    poolAddresses: Address[],
  ): Promise<TransactionBuilder> {
    return collectProtocolFees(this.ctx, poolAddresses);
  }
}
