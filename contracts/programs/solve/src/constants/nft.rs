use anchor_lang::prelude::*;

pub mod solve_nft_update_auth {
    use super::*;
    pub static ID: Pubkey = solana_program::pubkey!("Bbx8tpTG9fTnE5CXjZLys9gQi1i4nDUFn6MrU4Gby14J");
}

// Based on Metaplex TokenMetadata
//
// METADATA_NAME   : max  32 bytes
// METADATA_SYMBOL : max  10 bytes
// METADATA_URI    : max 200 bytes
pub const POSITION_METADATA_NAME: &str = "SOLV3 Position";
pub const POSITION_METADATA_SYMBOL: &str = "SOV3P";
pub const POSITION_METADATA_URI: &str = "https://solve3.fi/positions";

pub const POSITION_BUNDLE_METADATA_NAME_PREFIX: &str = "SOLV3 Position Bundle";
pub const POSITION_BUNDLE_METADATA_SYMBOL: &str = "SOV3PB";
pub const POSITION_BUNDLE_METADATA_URI: &str =
    "https://arweave.net/iB7a_xaRryQRlj9ZGswmf4hEo9Jp6bjljSqIkHVV1LY";
// Based on Token-2022 TokenMetadata extension
//
// There is no clear upper limit on the length of name, symbol, and uri,
// but it is safe for wallet apps to limit the uri to 128 bytes.
//
// see also: TokenMetadata struct
// https://github.com/solana-labs/solana-program-library/blob/cd6ce4b7709d2420bca60b4656bbd3d15d2e1485/token-metadata/interface/src/state.rs#L25
pub const POSITION_2022_METADATA_NAME_PREFIX: &str = "SOV3P";
pub const POSITION_2022_METADATA_SYMBOL: &str = "SOV3P";
pub const POSITION_2022_METADATA_URI_BASE: &str = "https://solve3.fi/positions";
