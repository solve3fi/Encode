use anchor_lang::prelude::*;

#[error_code]
pub enum ErrorCode {
    #[msg("Invalid mint amount - must be greater than 0")]
    InvalidMintAmount,
    
    #[msg("Invalid decimals - must be between 0 and 9")]
    InvalidDecimals,
    
    #[msg("Invalid token name - must be 1-32 characters")]
    InvalidTokenName,
    
    #[msg("Invalid token symbol - must be 1-10 characters")]
    InvalidTokenSymbol,
    
    #[msg("Invalid token URI - must be 1-200 characters")]
    InvalidTokenUri,

    #[msg("Invalid token account")]
    InvalidTokenAccount,
    
    #[msg("Unauthorized mint access")]
    UnauthorizedMintAccess,

    #[msg("Invalid configuration")]
    InvalidConfiguration,

    #[msg("Only the program's upgrade authority may perform this action")]
    UnauthorizedInitialization,

    #[msg("Minting this amount would exceed the 100,000,000 genesis supply")]
    GenesisSupplyExceeded,

    #[msg("Only the mint configuration authority may do this")]
    UnauthorizedAuthority,
}
