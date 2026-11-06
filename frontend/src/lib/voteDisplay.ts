import BN from "bn.js";
import Decimal from "decimal.js";

export const votingPowerUnits = (power: BN) => new Decimal(power.toString()).div(1e9).toNumber();
export const votingShare = (power: BN, total?: BN) => total && !total.isZero() ? new Decimal(power.toString()).div(total.toString()).mul(100).toNumber() : 0;

/** Epoch weights are keyed by gauge account, never by the pool account. */
export function gaugeVotingPower(snapshot: { votePools: { toString(): string }[]; votePowers: BN[] } | null | undefined, gauge: { toString(): string } | undefined): BN {
	if (!snapshot || !gauge) return new BN(0);
	const index = snapshot.votePools.findIndex((address) => address.toString() === gauge.toString());
	return index < 0 ? new BN(0) : snapshot.votePowers[index] ?? new BN(0);
}
