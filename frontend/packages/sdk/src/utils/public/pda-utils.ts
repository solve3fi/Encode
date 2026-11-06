import { BN } from "anchor-legacy";
import { AddressUtil } from "@solve3fi/common";
import type { PublicKey } from "@solana/web3.js";
import { METADATA_PROGRAM_ADDRESS } from "../../types/public";
import { PriceMath } from "./price-math";
import { TickUtil } from "./tick-utils";

const PDA_SOLVE_SEED = "solve";
const PDA_POSITION_SEED = "position";
const PDA_METADATA_SEED = "metadata";
const PDA_TICK_ARRAY_SEED = "tick_array";
const PDA_FEE_TIER_SEED = "fee_tier";
const PDA_ORACLE_SEED = "oracle";
const PDA_POSITION_BUNDLE_SEED = "position_bundle";
const PDA_BUNDLED_POSITION_SEED = "bundled_position";
const PDA_CONFIG_EXTENSION_SEED = "config_extension";
const PDA_TOKEN_BADGE_SEED = "token_badge";

/**
 * @category Solve Utils
 */
export class PDAUtil {
  /**
   *
   * @param programId
   * @param solvesConfigKey
   * @param tokenMintAKey
   * @param tokenMintBKey
   * @param tickSpacing
   * @returns
   */
  public static getSolve(
    programId: PublicKey,
    solvesConfigKey: PublicKey,
    tokenMintAKey: PublicKey,
    tokenMintBKey: PublicKey,
    tickSpacing: number,
  ) {
    return AddressUtil.findProgramAddress(
      [
        Buffer.from(PDA_SOLVE_SEED),
        solvesConfigKey.toBuffer(),
        tokenMintAKey.toBuffer(),
        tokenMintBKey.toBuffer(),
        new BN(tickSpacing).toArrayLike(Buffer, "le", 2),
      ],
      programId,
    );
  }

  /**
   * @category Program Derived Addresses
   * @param programId
   * @param positionMintKey
   * @returns
   */
  public static getPosition(programId: PublicKey, positionMintKey: PublicKey) {
    return AddressUtil.findProgramAddress(
      [Buffer.from(PDA_POSITION_SEED), positionMintKey.toBuffer()],
      programId,
    );
  }

  /**
   * @category Program Derived Addresses
   * @param positionMintKey
   * @returns
   */
  public static getPositionMetadata(positionMintKey: PublicKey) {
    return AddressUtil.findProgramAddress(
      [
        Buffer.from(PDA_METADATA_SEED),
        METADATA_PROGRAM_ADDRESS.toBuffer(),
        positionMintKey.toBuffer(),
      ],
      METADATA_PROGRAM_ADDRESS,
    );
  }

  /**
   * @category Program Derived Addresses
   * @param programId
   * @param solveAddress
   * @param startTick
   * @returns
   */
  public static getTickArray(
    programId: PublicKey,
    solveAddress: PublicKey,
    startTick: number,
  ) {
    return AddressUtil.findProgramAddress(
      [
        Buffer.from(PDA_TICK_ARRAY_SEED),
        solveAddress.toBuffer(),
        Buffer.from(startTick.toString()),
      ],
      programId,
    );
  }

  /**
   * Get the PDA of the tick array containing tickIndex.
   * tickArrayOffset can be used to get neighboring tick arrays.
   *
   * @param tickIndex
   * @param tickSpacing
   * @param solve
   * @param programId
   * @param tickArrayOffset
   * @returns
   */
  public static getTickArrayFromTickIndex(
    tickIndex: number,
    tickSpacing: number,
    solve: PublicKey,
    programId: PublicKey,
    tickArrayOffset = 0,
  ) {
    const startIndex = TickUtil.getStartTickIndex(
      tickIndex,
      tickSpacing,
      tickArrayOffset,
    );
    return PDAUtil.getTickArray(
      AddressUtil.toPubKey(programId),
      AddressUtil.toPubKey(solve),
      startIndex,
    );
  }

  public static getTickArrayFromSqrtPrice(
    sqrtPriceX64: BN,
    tickSpacing: number,
    solve: PublicKey,
    programId: PublicKey,
    tickArrayOffset = 0,
  ) {
    const tickIndex = PriceMath.sqrtPriceX64ToTickIndex(sqrtPriceX64);
    return PDAUtil.getTickArrayFromTickIndex(
      tickIndex,
      tickSpacing,
      solve,
      programId,
      tickArrayOffset,
    );
  }

  /**
   * @category Program Derived Addresses
   * @param programId
   * @param solvesConfigAddress
   * @param tickSpacing
   * @returns
   */
  public static getFeeTier(
    programId: PublicKey,
    solvesConfigAddress: PublicKey,
    tickSpacing: number,
  ) {
    return AddressUtil.findProgramAddress(
      [
        Buffer.from(PDA_FEE_TIER_SEED),
        solvesConfigAddress.toBuffer(),
        new BN(tickSpacing).toArrayLike(Buffer, "le", 2),
      ],
      programId,
    );
  }

  /**
   * @category Program Derived Addresses
   * @param programId
   * @param solveAddress
   * @returns
   */
  public static getOracle(programId: PublicKey, solveAddress: PublicKey) {
    return AddressUtil.findProgramAddress(
      [Buffer.from(PDA_ORACLE_SEED), solveAddress.toBuffer()],
      programId,
    );
  }

  /**
   * @category Program Derived Addresses
   * @param programId
   * @param positionBundleMintKey
   * @param bundleIndex
   * @returns
   */
  public static getBundledPosition(
    programId: PublicKey,
    positionBundleMintKey: PublicKey,
    bundleIndex: number,
  ) {
    return AddressUtil.findProgramAddress(
      [
        Buffer.from(PDA_BUNDLED_POSITION_SEED),
        positionBundleMintKey.toBuffer(),
        Buffer.from(bundleIndex.toString()),
      ],
      programId,
    );
  }

  /**
   * @category Program Derived Addresses
   * @param programId
   * @param positionBundleMintKey
   * @returns
   */
  public static getPositionBundle(
    programId: PublicKey,
    positionBundleMintKey: PublicKey,
  ) {
    return AddressUtil.findProgramAddress(
      [Buffer.from(PDA_POSITION_BUNDLE_SEED), positionBundleMintKey.toBuffer()],
      programId,
    );
  }

  /**
   * @category Program Derived Addresses
   * @param positionBundleMintKey
   * @returns
   */
  public static getPositionBundleMetadata(positionBundleMintKey: PublicKey) {
    return AddressUtil.findProgramAddress(
      [
        Buffer.from(PDA_METADATA_SEED),
        METADATA_PROGRAM_ADDRESS.toBuffer(),
        positionBundleMintKey.toBuffer(),
      ],
      METADATA_PROGRAM_ADDRESS,
    );
  }

  /**
   * @category Program Derived Addresses
   * @param programId
   * @param solvesConfigAddress
   * @returns
   */
  public static getConfigExtension(
    programId: PublicKey,
    solvesConfigAddress: PublicKey,
  ) {
    return AddressUtil.findProgramAddress(
      [
        Buffer.from(PDA_CONFIG_EXTENSION_SEED),
        solvesConfigAddress.toBuffer(),
      ],
      programId,
    );
  }

  /**
   * @category Program Derived Addresses
   * @param programId
   * @param solvesConfigAddress
   * @param tokenMintKey
   * @returns
   */
  public static getTokenBadge(
    programId: PublicKey,
    solvesConfigAddress: PublicKey,
    tokenMintKey: PublicKey,
  ) {
    return AddressUtil.findProgramAddress(
      [
        Buffer.from(PDA_TOKEN_BADGE_SEED),
        solvesConfigAddress.toBuffer(),
        tokenMintKey.toBuffer(),
      ],
      programId,
    );
  }
}
