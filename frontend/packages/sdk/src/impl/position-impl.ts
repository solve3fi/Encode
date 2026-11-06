import type { Address } from "anchor-legacy";
import type {
  Instruction,
  ResolvedTokenAddressInstruction,
} from "@solve3fi/common";
import {
  AddressUtil,
  TokenUtil,
  TransactionBuilder,
  ZERO,
  resolveOrCreateATAs,
} from "@solve3fi/common";
import { NATIVE_MINT, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import invariant from "tiny-invariant";
import type { SolveContext } from "../context";
import type {
  DecreaseLiquidityInput,
  IncreaseLiquidityInput,
} from "../instructions";
import {
  collectFeesIx,
  collectFeesV2Ix,
  collectRewardIx,
  collectRewardV2Ix,
  decreaseLiquidityIx,
  decreaseLiquidityV2Ix,
  increaseLiquidityIx,
  increaseLiquidityV2Ix,
  updateFeesAndRewardsIx,
} from "../instructions";
import type { SolveAccountFetchOptions } from "../network/public/fetcher";
import { IGNORE_CACHE, PREFER_CACHE } from "../network/public/fetcher";
import type {
  PositionData,
  TickArrayData,
  TickData,
  SolveData,
} from "../types/public";
import { getTickArrayDataForPosition } from "../utils/builder/position-builder-util";
import { PDAUtil, PoolUtil, TickArrayUtil, TickUtil } from "../utils/public";
import {
  TokenMintTypes,
  getTokenMintsFromSolves,
  resolveAtaForMints,
} from "../utils/solve-ata-utils";
import type { Position } from "../solve-client";
import { TokenExtensionUtil } from "../utils/public/token-extension-util";
import {
  MultipleTransactionBuilderFactoryWithAccountResolver,
  convertListToMap,
} from "../utils/txn-utils";

export class PositionImpl implements Position {
  private data: PositionData;
  private solveData: SolveData;
  private lowerTickArrayData: TickArrayData;
  private upperTickArrayData: TickArrayData;
  constructor(
    readonly ctx: SolveContext,
    readonly address: PublicKey,
    data: PositionData,
    solveData: SolveData,
    lowerTickArrayData: TickArrayData,
    upperTickArrayData: TickArrayData,
    readonly positionMintTokenProgramId: PublicKey,
  ) {
    this.data = data;
    this.solveData = solveData;
    this.lowerTickArrayData = lowerTickArrayData;
    this.upperTickArrayData = upperTickArrayData;
  }

  getAddress(): PublicKey {
    return this.address;
  }

  getPositionMintTokenProgramId(): PublicKey {
    return this.positionMintTokenProgramId;
  }

  getData(): PositionData {
    return this.data;
  }

  getSolveData(): SolveData {
    return this.solveData;
  }

  getLowerTickData(): TickData {
    return TickArrayUtil.getTickFromArray(
      this.lowerTickArrayData,
      this.data.tickLowerIndex,
      this.solveData.tickSpacing,
    );
  }

  getUpperTickData(): TickData {
    return TickArrayUtil.getTickFromArray(
      this.upperTickArrayData,
      this.data.tickUpperIndex,
      this.solveData.tickSpacing,
    );
  }

  async refreshData() {
    await this.refresh();
    return this.data;
  }

  async increaseLiquidity(
    liquidityInput: IncreaseLiquidityInput,
    resolveATA = true,
    sourceWallet?: Address,
    positionWallet?: Address,
    ataPayer?: Address,
  ) {
    const sourceWalletKey = sourceWallet
      ? AddressUtil.toPubKey(sourceWallet)
      : this.ctx.wallet.publicKey;
    const positionWalletKey = positionWallet
      ? AddressUtil.toPubKey(positionWallet)
      : this.ctx.wallet.publicKey;
    const ataPayerKey = ataPayer
      ? AddressUtil.toPubKey(ataPayer)
      : this.ctx.wallet.publicKey;

    const solve = await this.ctx.fetcher.getPool(
      this.data.solve,
      IGNORE_CACHE,
    );
    if (!solve) {
      throw new Error("Unable to fetch solve for this position.");
    }

    const tokenExtensionCtx =
      await TokenExtensionUtil.buildTokenExtensionContext(
        this.ctx.fetcher,
        solve,
        IGNORE_CACHE,
      );

    const txBuilder = new TransactionBuilder(
      this.ctx.provider.connection,
      this.ctx.provider.wallet,
      this.ctx.txBuilderOpts,
    );

    let tokenOwnerAccountA: PublicKey;
    let tokenOwnerAccountB: PublicKey;

    if (resolveATA) {
      const [ataA, ataB] = await resolveOrCreateATAs(
        this.ctx.connection,
        sourceWalletKey,
        [
          {
            tokenMint: solve.tokenMintA,
            wrappedSolAmountIn: liquidityInput.tokenMaxA,
          },
          {
            tokenMint: solve.tokenMintB,
            wrappedSolAmountIn: liquidityInput.tokenMaxB,
          },
        ],
        () => this.ctx.fetcher.getAccountRentExempt(),
        ataPayerKey,
        undefined, // use default
        this.ctx.accountResolverOpts.allowPDAOwnerAddress,
        this.ctx.accountResolverOpts.createWrappedSolAccountMethod,
      );
      const { address: ataAddrA, ...tokenOwnerAccountAIx } = ataA!;
      const { address: ataAddrB, ...tokenOwnerAccountBIx } = ataB!;
      tokenOwnerAccountA = ataAddrA;
      tokenOwnerAccountB = ataAddrB;
      txBuilder.addInstruction(tokenOwnerAccountAIx);
      txBuilder.addInstruction(tokenOwnerAccountBIx);
    } else {
      tokenOwnerAccountA = getAssociatedTokenAddressSync(
        solve.tokenMintA,
        sourceWalletKey,
        this.ctx.accountResolverOpts.allowPDAOwnerAddress,
        tokenExtensionCtx.tokenMintWithProgramA.tokenProgram,
      );
      tokenOwnerAccountB = getAssociatedTokenAddressSync(
        solve.tokenMintB,
        sourceWalletKey,
        this.ctx.accountResolverOpts.allowPDAOwnerAddress,
        tokenExtensionCtx.tokenMintWithProgramB.tokenProgram,
      );
    }
    const positionTokenAccount = getAssociatedTokenAddressSync(
      this.data.positionMint,
      positionWalletKey,
      this.ctx.accountResolverOpts.allowPDAOwnerAddress,
      this.positionMintTokenProgramId,
    );

    const baseParams = {
      ...liquidityInput,
      solve: this.data.solve,
      position: this.address,
      positionTokenAccount,
      tokenOwnerAccountA,
      tokenOwnerAccountB,
      tokenVaultA: solve.tokenVaultA,
      tokenVaultB: solve.tokenVaultB,
      solvesConfig: solve.solvesConfig,
      tickArrayLower: PDAUtil.getTickArray(
        this.ctx.program.programId,
        this.data.solve,
        TickUtil.getStartTickIndex(
          this.data.tickLowerIndex,
          solve.tickSpacing,
        ),
      ).publicKey,
      tickArrayUpper: PDAUtil.getTickArray(
        this.ctx.program.programId,
        this.data.solve,
        TickUtil.getStartTickIndex(
          this.data.tickUpperIndex,
          solve.tickSpacing,
        ),
      ).publicKey,
      positionAuthority: positionWalletKey,
    };
    // V2 can handle TokenProgram/TokenProgram pool, but it increases the size of transaction, so V1 is prefer if possible.
    const increaseIx = !TokenExtensionUtil.isV2IxRequiredPool(tokenExtensionCtx)
      ? increaseLiquidityIx(this.ctx.program, baseParams)
      : increaseLiquidityV2Ix(this.ctx.program, {
          ...baseParams,
          tokenMintA: solve.tokenMintA,
          tokenMintB: solve.tokenMintB,
          tokenProgramA: tokenExtensionCtx.tokenMintWithProgramA.tokenProgram,
          tokenProgramB: tokenExtensionCtx.tokenMintWithProgramB.tokenProgram,
          ...(await TokenExtensionUtil.getExtraAccountMetasForTransferHookForPool(
            this.ctx.connection,
            tokenExtensionCtx,
            baseParams.tokenOwnerAccountA,
            baseParams.tokenVaultA,
            baseParams.positionAuthority,
            baseParams.tokenOwnerAccountB,
            baseParams.tokenVaultB,
            baseParams.positionAuthority,
          )),
        });
    txBuilder.addInstruction(increaseIx);
    return txBuilder;
  }

  async decreaseLiquidity(
    liquidityInput: DecreaseLiquidityInput,
    resolveATA = true,
    sourceWallet?: Address,
    positionWallet?: Address,
    ataPayer?: Address,
  ) {
    const sourceWalletKey = sourceWallet
      ? AddressUtil.toPubKey(sourceWallet)
      : this.ctx.wallet.publicKey;
    const positionWalletKey = positionWallet
      ? AddressUtil.toPubKey(positionWallet)
      : this.ctx.wallet.publicKey;
    const ataPayerKey = ataPayer
      ? AddressUtil.toPubKey(ataPayer)
      : this.ctx.wallet.publicKey;
    const solve = await this.ctx.fetcher.getPool(
      this.data.solve,
      IGNORE_CACHE,
    );

    if (!solve) {
      throw new Error("Unable to fetch solve for this position.");
    }

    const tokenExtensionCtx =
      await TokenExtensionUtil.buildTokenExtensionContext(
        this.ctx.fetcher,
        solve,
        IGNORE_CACHE,
      );

    const txBuilder = new TransactionBuilder(
      this.ctx.provider.connection,
      this.ctx.provider.wallet,
      this.ctx.txBuilderOpts,
    );
    let tokenOwnerAccountA: PublicKey;
    let tokenOwnerAccountB: PublicKey;

    if (resolveATA) {
      const [ataA, ataB] = await resolveOrCreateATAs(
        this.ctx.connection,
        sourceWalletKey,
        [
          { tokenMint: solve.tokenMintA },
          { tokenMint: solve.tokenMintB },
        ],
        () => this.ctx.fetcher.getAccountRentExempt(),
        ataPayerKey,
        undefined, // use default
        this.ctx.accountResolverOpts.allowPDAOwnerAddress,
        this.ctx.accountResolverOpts.createWrappedSolAccountMethod,
      );
      const { address: ataAddrA, ...tokenOwnerAccountAIx } = ataA!;
      const { address: ataAddrB, ...tokenOwnerAccountBIx } = ataB!;
      tokenOwnerAccountA = ataAddrA;
      tokenOwnerAccountB = ataAddrB;
      txBuilder.addInstruction(tokenOwnerAccountAIx);
      txBuilder.addInstruction(tokenOwnerAccountBIx);
    } else {
      tokenOwnerAccountA = getAssociatedTokenAddressSync(
        solve.tokenMintA,
        sourceWalletKey,
        this.ctx.accountResolverOpts.allowPDAOwnerAddress,
        tokenExtensionCtx.tokenMintWithProgramA.tokenProgram,
      );
      tokenOwnerAccountB = getAssociatedTokenAddressSync(
        solve.tokenMintB,
        sourceWalletKey,
        this.ctx.accountResolverOpts.allowPDAOwnerAddress,
        tokenExtensionCtx.tokenMintWithProgramB.tokenProgram,
      );
    }

    const baseParams = {
      ...liquidityInput,
      solve: this.data.solve,
      position: this.address,
      positionTokenAccount: getAssociatedTokenAddressSync(
        this.data.positionMint,
        positionWalletKey,
        this.ctx.accountResolverOpts.allowPDAOwnerAddress,
        this.positionMintTokenProgramId,
      ),
      tokenOwnerAccountA,
      tokenOwnerAccountB,
      tokenVaultA: solve.tokenVaultA,
      tokenVaultB: solve.tokenVaultB,
      solvesConfig: solve.solvesConfig,
      tickArrayLower: PDAUtil.getTickArray(
        this.ctx.program.programId,
        this.data.solve,
        TickUtil.getStartTickIndex(
          this.data.tickLowerIndex,
          solve.tickSpacing,
        ),
      ).publicKey,
      tickArrayUpper: PDAUtil.getTickArray(
        this.ctx.program.programId,
        this.data.solve,
        TickUtil.getStartTickIndex(
          this.data.tickUpperIndex,
          solve.tickSpacing,
        ),
      ).publicKey,
      positionAuthority: positionWalletKey,
    };
    // V2 can handle TokenProgram/TokenProgram pool, but it increases the size of transaction, so V1 is prefer if possible.
    const decreaseIx = !TokenExtensionUtil.isV2IxRequiredPool(tokenExtensionCtx)
      ? decreaseLiquidityIx(this.ctx.program, baseParams)
      : decreaseLiquidityV2Ix(this.ctx.program, {
          ...baseParams,
          tokenMintA: solve.tokenMintA,
          tokenMintB: solve.tokenMintB,
          tokenProgramA: tokenExtensionCtx.tokenMintWithProgramA.tokenProgram,
          tokenProgramB: tokenExtensionCtx.tokenMintWithProgramB.tokenProgram,
          ...(await TokenExtensionUtil.getExtraAccountMetasForTransferHookForPool(
            this.ctx.connection,
            tokenExtensionCtx,
            baseParams.tokenVaultA,
            baseParams.tokenOwnerAccountA,
            baseParams.solve, // vault to owner, so pool is authority
            baseParams.tokenVaultB,
            baseParams.tokenOwnerAccountB,
            baseParams.solve, // vault to owner, so pool is authority
          )),
        });
    txBuilder.addInstruction(decreaseIx);
    return txBuilder;
  }

  async collectFees(
    updateFeesAndRewards: boolean = true,
    ownerTokenAccountMap?: Partial<Record<string, Address>>,
    destinationWallet?: Address,
    positionWallet?: Address,
    ataPayer?: Address,
    opts: SolveAccountFetchOptions = PREFER_CACHE,
  ): Promise<TransactionBuilder> {
    const [destinationWalletKey, positionWalletKey, ataPayerKey] =
      AddressUtil.toPubKeys([
        destinationWallet ?? this.ctx.wallet.publicKey,
        positionWallet ?? this.ctx.wallet.publicKey,
        ataPayer ?? this.ctx.wallet.publicKey,
      ]);

    const solve = await this.ctx.fetcher.getPool(this.data.solve, opts);
    if (!solve) {
      throw new Error(
        `Unable to fetch solve (${this.data.solve}) for this position (${this.address}).`,
      );
    }

    const tokenExtensionCtx =
      await TokenExtensionUtil.buildTokenExtensionContext(
        this.ctx.fetcher,
        solve,
        IGNORE_CACHE,
      );

    let txBuilder = new TransactionBuilder(
      this.ctx.provider.connection,
      this.ctx.provider.wallet,
      this.ctx.txBuilderOpts,
    );

    const accountExemption = await this.ctx.fetcher.getAccountRentExempt();

    let ataMap = { ...ownerTokenAccountMap };

    if (!ownerTokenAccountMap) {
      const affliatedMints = getTokenMintsFromSolves(
        [solve],
        TokenMintTypes.POOL_ONLY,
      );
      const { ataTokenAddresses: affliatedTokenAtaMap, resolveAtaIxs } =
        await resolveAtaForMints(this.ctx, {
          mints: affliatedMints.mintMap,
          accountExemption,
          receiver: destinationWalletKey,
          payer: ataPayerKey,
        });

      txBuilder.addInstructions(resolveAtaIxs);

      if (affliatedMints.hasNativeMint) {
        let { address: wSOLAta, ...resolveWSolIx } =
          TokenUtil.createWrappedNativeAccountInstruction(
            destinationWalletKey,
            ZERO,
            accountExemption,
            ataPayerKey,
            destinationWalletKey,
            this.ctx.accountResolverOpts.createWrappedSolAccountMethod,
          );
        affliatedTokenAtaMap[NATIVE_MINT.toBase58()] = wSOLAta;
        txBuilder.addInstruction(resolveWSolIx);
      }

      ataMap = { ...affliatedTokenAtaMap };
    }

    const tokenOwnerAccountA = ataMap[solve.tokenMintA.toBase58()];
    invariant(
      !!tokenOwnerAccountA,
      `No owner token account provided for wallet ${destinationWalletKey.toBase58()} for token A ${solve.tokenMintA.toBase58()} `,
    );
    const tokenOwnerAccountB = ataMap[solve.tokenMintB.toBase58()];
    invariant(
      !!tokenOwnerAccountB,
      `No owner token account provided for wallet ${destinationWalletKey.toBase58()} for token B ${solve.tokenMintB.toBase58()} `,
    );

    const positionTokenAccount = getAssociatedTokenAddressSync(
      this.data.positionMint,
      positionWalletKey,
      this.ctx.accountResolverOpts.allowPDAOwnerAddress,
      this.positionMintTokenProgramId,
    );

    if (updateFeesAndRewards && !this.data.liquidity.isZero()) {
      const updateIx = await this.updateFeesAndRewards();
      txBuilder.addInstruction(updateIx);
    }

    const baseParams = {
      solve: this.data.solve,
      position: this.address,
      positionTokenAccount,
      tokenOwnerAccountA: AddressUtil.toPubKey(tokenOwnerAccountA),
      tokenOwnerAccountB: AddressUtil.toPubKey(tokenOwnerAccountB),
      tokenVaultA: solve.tokenVaultA,
      tokenVaultB: solve.tokenVaultB,
      positionAuthority: positionWalletKey,
    };
    // V2 can handle TokenProgram/TokenProgram pool, but it increases the size of transaction, so V1 is prefer if possible.
    const ix = !TokenExtensionUtil.isV2IxRequiredPool(tokenExtensionCtx)
      ? collectFeesIx(this.ctx.program, baseParams)
      : collectFeesV2Ix(this.ctx.program, {
          ...baseParams,
          tokenMintA: solve.tokenMintA,
          tokenMintB: solve.tokenMintB,
          tokenProgramA: tokenExtensionCtx.tokenMintWithProgramA.tokenProgram,
          tokenProgramB: tokenExtensionCtx.tokenMintWithProgramB.tokenProgram,
          ...(await TokenExtensionUtil.getExtraAccountMetasForTransferHookForPool(
            this.ctx.connection,
            tokenExtensionCtx,
            baseParams.tokenVaultA,
            baseParams.tokenOwnerAccountA,
            baseParams.solve, // vault to owner, so pool is authority
            baseParams.tokenVaultB,
            baseParams.tokenOwnerAccountB,
            baseParams.solve, // vault to owner, so pool is authority
          )),
        });
    txBuilder.addInstruction(ix);

    return txBuilder;
  }

  async collectRewards(
    rewardsToCollect?: Address[],
    updateFeesAndRewards: boolean = true,
    ownerTokenAccountMap?: Partial<Record<string, Address>>,
    destinationWallet?: Address,
    positionWallet?: Address,
    ataPayer?: Address,
    opts: SolveAccountFetchOptions = IGNORE_CACHE,
  ): Promise<TransactionBuilder[]> {
    const [destinationWalletKey, positionWalletKey, ataPayerKey] =
      AddressUtil.toPubKeys([
        destinationWallet ?? this.ctx.wallet.publicKey,
        positionWallet ?? this.ctx.wallet.publicKey,
        ataPayer ?? this.ctx.wallet.publicKey,
      ]);

    const solve = await this.ctx.fetcher.getPool(this.data.solve, opts);
    if (!solve) {
      throw new Error(
        `Unable to fetch solve(${this.data.solve}) for this position(${this.address}).`,
      );
    }

    const initializedRewards = solve.rewardInfos.filter((info) =>
      PoolUtil.isRewardInitialized(info),
    );

    const tokenExtensionCtx =
      await TokenExtensionUtil.buildTokenExtensionContext(
        this.ctx.fetcher,
        solve,
        IGNORE_CACHE,
      );

    let resolvedAtas: Record<string, ResolvedTokenAddressInstruction>;
    if (ownerTokenAccountMap) {
      resolvedAtas = {};
      Object.entries(ownerTokenAccountMap).forEach(([mint, address]) => {
        if (!address) return;

        resolvedAtas[mint] = {
          address: AddressUtil.toPubKey(address),
          instructions: [],
          cleanupInstructions: [],
          signers: [],
          tokenProgram: PublicKey.default, // unused (dummy)
        };
      });
    } else {
      const accountExemption = await this.ctx.fetcher.getAccountRentExempt();
      const rewardMints = getTokenMintsFromSolves(
        [solve],
        TokenMintTypes.REWARD_ONLY,
      );
      resolvedAtas = convertListToMap(
        await resolveOrCreateATAs(
          this.ctx.connection,
          destinationWalletKey,
          rewardMints.mintMap.map((tokenMint) => ({ tokenMint })),
          async () => accountExemption,
          ataPayerKey,
          true, // CreateIdempotent
          this.ctx.accountResolverOpts.allowPDAOwnerAddress,
        ),
        rewardMints.mintMap.map((mint) => mint.toBase58()),
      );
    }

    const builder = new MultipleTransactionBuilderFactoryWithAccountResolver(
      this.ctx,
      resolvedAtas,
      destinationWalletKey,
      ataPayerKey,
    );

    const positionTokenAccount = getAssociatedTokenAddressSync(
      this.data.positionMint,
      positionWalletKey,
      this.ctx.accountResolverOpts.allowPDAOwnerAddress,
      this.positionMintTokenProgramId,
    );

    if (updateFeesAndRewards && !this.data.liquidity.isZero()) {
      await builder.addInstructions(async () => {
        const updateIx = await this.updateFeesAndRewards();
        return [updateIx];
      });
    }

    for (let index = 0; index < initializedRewards.length; index++) {
      const info = initializedRewards[index];
      if (
        rewardsToCollect &&
        !rewardsToCollect.some((r) => r.toString() === info.mint.toBase58())
      ) {
        // If rewardsToCollect is specified and this reward is not in it,
        // don't include collectIX for that in TX
        break;
      }

      await builder.addInstructions(async (resolve) => {
        const rewardOwnerAccount = resolve(info.mint.toBase58());
        invariant(
          !!rewardOwnerAccount,
          `No owner token account provided for wallet ${destinationWalletKey.toBase58()} for reward ${index} token ${info.mint.toBase58()} `,
        );

        const baseParams = {
          solve: this.data.solve,
          position: this.address,
          positionTokenAccount,
          rewardIndex: index,
          rewardOwnerAccount: AddressUtil.toPubKey(rewardOwnerAccount),
          rewardVault: info.vault,
          positionAuthority: positionWalletKey,
        };
        // V2 can handle TokenProgram/TokenProgram pool, but it increases the size of transaction, so V1 is prefer if possible.
        const ix = !TokenExtensionUtil.isV2IxRequiredReward(
          tokenExtensionCtx,
          index,
        )
          ? collectRewardIx(this.ctx.program, baseParams)
          : collectRewardV2Ix(this.ctx.program, {
              ...baseParams,
              rewardMint: info.mint,
              rewardTokenProgram:
                tokenExtensionCtx.rewardTokenMintsWithProgram[index]!
                  .tokenProgram,
              rewardTransferHookAccounts:
                await TokenExtensionUtil.getExtraAccountMetasForTransferHook(
                  this.ctx.connection,
                  tokenExtensionCtx.rewardTokenMintsWithProgram[index]!,
                  baseParams.rewardVault,
                  baseParams.rewardOwnerAccount,
                  baseParams.solve, // vault to owner, so pool is authority
                ),
            });

        return [ix];
      });
    }

    return builder.build();
  }

  private async refresh() {
    const positionAccount = await this.ctx.fetcher.getPosition(
      this.address,
      IGNORE_CACHE,
    );
    if (!!positionAccount) {
      this.data = positionAccount;
    }
    const solveAccount = await this.ctx.fetcher.getPool(
      this.data.solve,
      IGNORE_CACHE,
    );
    if (!!solveAccount) {
      this.solveData = solveAccount;
    }

    const [lowerTickArray, upperTickArray] = await getTickArrayDataForPosition(
      this.ctx,
      this.data,
      this.solveData,
      IGNORE_CACHE,
    );
    if (lowerTickArray) {
      this.lowerTickArrayData = lowerTickArray;
    }
    if (upperTickArray) {
      this.upperTickArrayData = upperTickArray;
    }
  }

  private async updateFeesAndRewards(): Promise<Instruction> {
    const solve = await this.ctx.fetcher.getPool(this.data.solve);
    if (!solve) {
      throw new Error(
        `Unable to fetch solve(${this.data.solve}) for this position(${this.address}).`,
      );
    }

    const [tickArrayLowerPda, tickArrayUpperPda] = [
      this.data.tickLowerIndex,
      this.data.tickUpperIndex,
    ].map((tickIndex) =>
      PDAUtil.getTickArrayFromTickIndex(
        tickIndex,
        solve.tickSpacing,
        this.data.solve,
        this.ctx.program.programId,
      ),
    );

    const updateIx = updateFeesAndRewardsIx(this.ctx.program, {
      solve: this.data.solve,
      position: this.address,
      tickArrayLower: tickArrayLowerPda.publicKey,
      tickArrayUpper: tickArrayUpperPda.publicKey,
    });

    return updateIx;
  }
}
