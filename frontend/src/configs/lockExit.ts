// Mirrors EXIT_FEE_BPS in ve33-contracts/programs/vesolve/src/constants/ve.rs:
// the INITIAL exit fee. Admin can change it (effective next epoch), so the UI
// reads the value in force from the ExitFeeConfig account (useExitFeeBps) and
// uses this only until that has loaded or when the account does not exist.
export const EXIT_FEE_BPS = 4_000;
export const EXIT_FEE_PERCENT = EXIT_FEE_BPS / 100;

// Mirrors EXIT_DISABLED_UNTIL_EPOCH in ve33-contracts/programs/vesolve/src/constants/ve.rs.
// exit_lock fails with ExitDisabled while the protocol epoch is below this.
export const EXIT_DISABLED_UNTIL_EPOCH = 4;
