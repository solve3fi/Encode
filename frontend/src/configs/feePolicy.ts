// protocolFeeRate is the gauge/protocol share of each trading fee (basis points).
// This changes fee allocation, not the pool's swap fee tier.
// During the soft launch, pools enrolled in the LP incentive program
// (src/configs/lpIncentives.ts, Admin › LP Incentives) override the ungauged
// rate with their configured fee share; the reconciler honours that override.
// Ungauged pools pay 95/5 (spec §3): 5% to the Treasury, matching the vesolve program.
export const UNGAUGED_PROTOCOL_FEE_RATE = 500;
export const GAUGED_PROTOCOL_FEE_RATE = 10_000;
