import { BN } from "anchor-legacy";
import { PublicKey } from "@solana/web3.js";

/**
 * The number of rewards supported by this solve.
 * @category Constants
 */
export const NUM_REWARDS = 3;

/**
 * The maximum tick index supported by the Solve program.
 * @category Constants
 */
export const MAX_TICK_INDEX = 443636;

/**
 * The minimum tick index supported by the Solve program.
 * @category Constants
 */
export const MIN_TICK_INDEX = -443636;

/**
 * The maximum sqrt-price supported by the Solve program.
 * @category Constants
 */
export const MAX_SQRT_PRICE = "79226673515401279992447579055";

/**
 * The minimum sqrt-price supported by the Solve program.
 * @category Constants
 */
export const MIN_SQRT_PRICE = "4295048016";

/**
 * The minimum sqrt-price supported by the Solve program.
 * @category Constants
 */
export const MIN_SQRT_PRICE_BN = new BN(MIN_SQRT_PRICE);

/**
 * The maximum sqrt-price supported by the Solve program.
 * @category Constants
 */
export const MAX_SQRT_PRICE_BN = new BN(MAX_SQRT_PRICE);

/**
 * The number of initialized ticks that a tick-array account can hold.
 * @category Constants
 */
export const TICK_ARRAY_SIZE = 88;

/**
 * The number of bundled positions that a position-bundle account can hold.
 * @category Constants
 */
export const POSITION_BUNDLE_SIZE = 256;

/**
 * @category Constants
 */
export const METADATA_PROGRAM_ADDRESS = new PublicKey(
  "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s",
);

/**
 * @category Constants
 */
export const MEMO_PROGRAM_ADDRESS = new PublicKey(
  "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr",
);

/**
 * The maximum number of tick-arrays that can traversed across in a swap.
 * @category Constants
 */
export const MAX_SWAP_TICK_ARRAYS = 3;

/**
 * The maximum number of supplemental tick-arrays that can be provided in a swap.
 * @category Constants
 */
export const MAX_SUPPLEMENTAL_TICK_ARRAYS = 3;

/**
 * The denominator which the protocol fee rate is divided on.
 * @category Constants
 */
export const PROTOCOL_FEE_RATE_MUL_VALUE = new BN(10_000);

/**
 * The denominator which the fee rate is divided on.
 * @category Constants
 */
export const FEE_RATE_MUL_VALUE = new BN(1_000_000);

/**
 * The public key that is allowed to update the metadata of Solve NFTs. This is the address the Solve program
 * itself requires (programs/solve/src/constants/nft.rs, solve_nft_update_auth), not the upstream default.
 * @category Constants
 */
export const SOLVE_NFT_UPDATE_AUTH = new PublicKey(
  "Bbx8tpTG9fTnE5CXjZLys9gQi1i4nDUFn6MrU4Gby14J",
);

/**
 * The tick spacing (inclusive) at which a solve only supports full-range positions.
 * @category Constants
 */
export const FULL_RANGE_ONLY_TICK_SPACING_THRESHOLD = 32768;

/**
 * The tick spacing for splash pools.
 * @category Constants
 */
export const SPLASH_POOL_TICK_SPACING = 32896;
