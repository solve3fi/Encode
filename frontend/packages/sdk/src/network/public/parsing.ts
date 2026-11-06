import type { Idl } from "anchor-legacy";
import { BorshAccountsCoder } from "anchor-legacy";
import type { ParsableEntity } from "@solve3fi/common";
import { staticImplements } from "@solve3fi/common";
import type { AccountInfo, PublicKey } from "@solana/web3.js";
import * as SolveIDL from "../../artifacts/solve.json";
import type {
  FeeTierData,
  PositionBundleData,
  PositionData,
  TickArrayData,
  TokenBadgeData,
  SolveData,
  SolvesConfigData,
  SolvesConfigExtensionData,
} from "../../types/public";
import { AccountName } from "../../types/public";

/**
 * @category Network
 */
@staticImplements<ParsableEntity<SolvesConfigData>>()
export class ParsableSolvesConfig {
  public static parse(
    address: PublicKey,
    accountData: AccountInfo<Buffer> | undefined | null,
  ): SolvesConfigData | null {
    if (!accountData?.data) {
      return null;
    }

    try {
      return parseAnchorAccount(AccountName.SolvesConfig, accountData);
    } catch (e) {
      console.error(`error while parsing SolvesConfig: ${e}`);
      return null;
    }
  }
}

/**
 * @category Network
 */
@staticImplements<ParsableEntity<SolveData>>()
export class ParsableSolve {
  public static parse(
    address: PublicKey,
    accountData: AccountInfo<Buffer> | undefined | null,
  ): SolveData | null {
    if (!accountData?.data) {
      return null;
    }

    try {
      return parseAnchorAccount(AccountName.Solve, accountData);
    } catch (e) {
      console.error(`error while parsing Solve: ${e}`);
      return null;
    }
  }
}

/**
 * @category Network
 */
@staticImplements<ParsableEntity<PositionData>>()
export class ParsablePosition {
  public static parse(
    address: PublicKey,
    accountData: AccountInfo<Buffer> | undefined | null,
  ): PositionData | null {
    if (!accountData?.data) {
      return null;
    }

    try {
      return parseAnchorAccount(AccountName.Position, accountData);
    } catch (e) {
      console.error(`error while parsing Position: ${e}`);
      return null;
    }
  }
}

/**
 * @category Network
 */
@staticImplements<ParsableEntity<TickArrayData>>()
export class ParsableTickArray {
  public static parse(
    address: PublicKey,
    accountData: AccountInfo<Buffer> | undefined | null,
  ): TickArrayData | null {
    if (!accountData?.data) {
      return null;
    }

    try {
      return parseAnchorAccount(AccountName.TickArray, accountData);
    } catch (e) {
      console.error(`error while parsing TickArray: ${e}`);
      return null;
    }
  }
}

/**
 * @category Network
 */
@staticImplements<ParsableEntity<FeeTierData>>()
export class ParsableFeeTier {
  public static parse(
    address: PublicKey,
    accountData: AccountInfo<Buffer> | undefined | null,
  ): FeeTierData | null {
    if (!accountData?.data) {
      return null;
    }

    try {
      return parseAnchorAccount(AccountName.FeeTier, accountData);
    } catch (e) {
      console.error(`error while parsing FeeTier: ${e}`);
      return null;
    }
  }
}

/**
 * @category Network
 */
@staticImplements<ParsableEntity<PositionBundleData>>()
export class ParsablePositionBundle {
  public static parse(
    address: PublicKey,
    accountData: AccountInfo<Buffer> | undefined | null,
  ): PositionBundleData | null {
    if (!accountData?.data) {
      return null;
    }

    try {
      return parseAnchorAccount(AccountName.PositionBundle, accountData);
    } catch (e) {
      console.error(`error while parsing PositionBundle: ${e}`);
      return null;
    }
  }
}

/**
 * @category Network
 */
@staticImplements<ParsableEntity<SolvesConfigExtensionData>>()
export class ParsableSolvesConfigExtension {
  public static parse(
    address: PublicKey,
    accountData: AccountInfo<Buffer> | undefined | null,
  ): SolvesConfigExtensionData | null {
    if (!accountData?.data) {
      return null;
    }

    try {
      return parseAnchorAccount(
        AccountName.SolvesConfigExtension,
        accountData,
      );
    } catch (e) {
      console.error(`error while parsing SolvesConfigExtension: ${e}`);
      return null;
    }
  }
}

/**
 * @category Network
 */
@staticImplements<ParsableEntity<TokenBadgeData>>()
export class ParsableTokenBadge {
  public static parse(
    address: PublicKey,
    accountData: AccountInfo<Buffer> | undefined | null,
  ): TokenBadgeData | null {
    if (!accountData?.data) {
      return null;
    }

    try {
      return parseAnchorAccount(AccountName.TokenBadge, accountData);
    } catch (e) {
      console.error(`error while parsing TokenBadge: ${e}`);
      return null;
    }
  }
}

const SolveCoder = new BorshAccountsCoder(SolveIDL as Idl);

function parseAnchorAccount(
  accountName: AccountName,
  accountData: AccountInfo<Buffer>,
) {
  const data = accountData.data;
  const discriminator = BorshAccountsCoder.accountDiscriminator(accountName);
  if (discriminator.compare(data.slice(0, 8))) {
    console.error("incorrect account name during parsing");
    return null;
  }

  try {
    return SolveCoder.decode(accountName, data);
  } catch (_e) {
    console.error("unknown account name during parsing");
    return null;
  }
}
