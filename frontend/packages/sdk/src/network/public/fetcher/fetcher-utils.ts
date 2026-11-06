import type { Address } from "@solve3fi/common";
import { AddressUtil } from "@solve3fi/common";
import type { Connection, PublicKey } from "@solana/web3.js";
import invariant from "tiny-invariant";
import type {
  PositionBundleData,
  PositionData,
  SolveData,
} from "../../../types/public";
import {
  AccountName,
  SOLVE_CODER,
  getAccountSize,
} from "../../../types/public";
import { ParsableSolve } from "../parsing";
import {
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  unpackAccount,
} from "@solana/spl-token";
import { PDAUtil, PositionBundleUtil } from "../../../utils/public";
import { IGNORE_CACHE } from "../../..";
import type { SolveContext } from "../../..";

/**
 * Retrieve a list of solve addresses and accounts filtered by the given params using
 * getProgramAccounts.
 * @category Network
 *
 * @param connection The connection to use to fetch accounts
 * @param programId The Solve program to search Solve accounts for
 * @param configId The {@link SolveConfig} account program address to filter by
 * @returns tuple of solve addresses and accounts
 */
export async function getAllSolveAccountsForConfig({
  connection,
  programId,
  configId,
}: {
  connection: Connection;
  programId: Address;
  configId: Address;
}): Promise<ReadonlyMap<string, SolveData>> {
  const filters = [
    { dataSize: getAccountSize(AccountName.Solve) },
    {
      memcmp: SOLVE_CODER.memcmp(
        AccountName.Solve,
        AddressUtil.toPubKey(configId).toBuffer(),
      ),
    },
  ];

  const accounts = await connection.getProgramAccounts(
    AddressUtil.toPubKey(programId),
    {
      filters,
    },
  );

  const parsedAccounts: [string, SolveData][] = [];
  accounts.forEach(({ pubkey, account }) => {
    const parsedAccount = ParsableSolve.parse(pubkey, account);
    invariant(
      !!parsedAccount,
      `could not parse solve: ${pubkey.toBase58()}`,
    );
    parsedAccounts.push([AddressUtil.toString(pubkey), parsedAccount]);
  });

  return new Map(
    parsedAccounts.map(([address, pool]) => [
      AddressUtil.toString(address),
      pool,
    ]),
  );
}

export type PositionMap = {
  positions: ReadonlyMap<string, PositionData>;
  positionsWithTokenExtensions: ReadonlyMap<string, PositionData>;
  positionBundles: BundledPositionMap[];
};

export type BundledPositionMap = {
  positionBundleAddress: Address;
  positionBundleData: PositionBundleData;
  bundledPositions: ReadonlyMap<number, PositionData>;
};

/**
 * Retrieve a list of position addresses and accounts filtered by the given params.
 * @category Network
 *
 * @param ctx The solve context
 * @param owner The owner of the positions
 * @param includesPositions Whether to fetch positions
 * @param includesPositionsWithTokenExtensions Whether to fetch positions with token extensions
 * @param includesBundledPositions Whether to fetch bundled positions
 * @returns The map of position addresses to position accounts
 */
export async function getAllPositionAccountsByOwner({
  ctx,
  owner,
  includesPositions = true,
  includesPositionsWithTokenExtensions = true,
  includesBundledPositions = false,
}: {
  ctx: SolveContext;
  owner: Address;
  includesPositions?: boolean;
  includesPositionsWithTokenExtensions?: boolean;
  includesBundledPositions?: boolean;
}): Promise<PositionMap> {
  const positions = !includesPositions
    ? new Map()
    : await findPositions(ctx, owner, TOKEN_PROGRAM_ID);

  const positionsWithTokenExtensions = !includesPositionsWithTokenExtensions
    ? new Map()
    : await findPositions(ctx, owner, TOKEN_2022_PROGRAM_ID);

  const positionBundles = !includesBundledPositions
    ? []
    : await findBundledPositions(ctx, owner);

  return {
    positions,
    positionsWithTokenExtensions,
    positionBundles,
  };
}

async function findPositions(
  ctx: SolveContext,
  owner: Address,
  tokenProgramId: Address,
): Promise<ReadonlyMap<string, PositionData>> {
  const programId = AddressUtil.toPubKey(tokenProgramId);

  const tokenAccounts = await ctx.connection.getTokenAccountsByOwner(
    AddressUtil.toPubKey(owner),
    {
      programId,
    },
  );

  // Get candidate addresses for the position
  const candidatePubkeys: PublicKey[] = [];
  tokenAccounts.value.forEach((ta) => {
    const parsed = unpackAccount(ta.pubkey, ta.account, programId);
    if (parsed.amount === 1n) {
      const pda = PDAUtil.getPosition(ctx.program.programId, parsed.mint);
      candidatePubkeys.push(pda.publicKey);
    }
  });

  // Fetch candidate accounts
  const positionData = await ctx.fetcher.getPositions(
    candidatePubkeys,
    IGNORE_CACHE,
  );

  // Drop null
  return new Map(
    Array.from(positionData.entries()).filter(([_, v]) => v !== null) as [
      string,
      PositionData,
    ][],
  );
}

async function findBundledPositions(
  ctx: SolveContext,
  owner: Address,
): Promise<
  {
    positionBundleAddress: Address;
    positionBundleData: PositionBundleData;
    bundledPositions: ReadonlyMap<number, PositionData>;
  }[]
> {
  const tokenAccounts = await ctx.connection.getTokenAccountsByOwner(
    AddressUtil.toPubKey(owner),
    {
      programId: TOKEN_PROGRAM_ID,
    },
  );

  // Get candidate addresses for the position bundle
  const candidatePubkeys: PublicKey[] = [];
  tokenAccounts.value.forEach((ta) => {
    const parsed = unpackAccount(ta.pubkey, ta.account, TOKEN_PROGRAM_ID);
    if (parsed.amount === 1n) {
      const pda = PDAUtil.getPositionBundle(ctx.program.programId, parsed.mint);
      candidatePubkeys.push(pda.publicKey);
    }
  });

  // Fetch candidate accounts
  const positionBundleData = await ctx.fetcher.getPositionBundles(
    candidatePubkeys,
    IGNORE_CACHE,
  );

  // Drop null
  const positionBundles = Array.from(positionBundleData.entries()).filter(
    ([_, v]) => v !== null,
  ) as [string, PositionBundleData][];

  const bundledPositionPubkeys: PublicKey[] = [];
  positionBundles.forEach(([_, positionBundle]) => {
    const bundleIndexes =
      PositionBundleUtil.getOccupiedBundleIndexes(positionBundle);
    bundleIndexes.forEach((bundleIndex) => {
      const pda = PDAUtil.getBundledPosition(
        ctx.program.programId,
        positionBundle.positionBundleMint,
        bundleIndex,
      );
      bundledPositionPubkeys.push(pda.publicKey);
    });
  });

  // Fetch bundled positions
  const bundledPositionData = await ctx.fetcher.getPositions(
    bundledPositionPubkeys,
    IGNORE_CACHE,
  );

  return positionBundles.map(([positionBundleAddress, positionBundleData]) => {
    const bundleIndexes =
      PositionBundleUtil.getOccupiedBundleIndexes(positionBundleData);
    const bundledPositions = new Map(
      bundleIndexes
        .map((bundleIndex) => {
          const pda = PDAUtil.getBundledPosition(
            ctx.program.programId,
            positionBundleData.positionBundleMint,
            bundleIndex,
          );
          return [
            bundleIndex,
            bundledPositionData.get(AddressUtil.toString(pda.publicKey)),
          ];
        })
        .filter(([_, v]) => v !== null) as [number, PositionData][],
    );

    return {
      positionBundleAddress,
      positionBundleData,
      bundledPositions,
    };
  });
}
