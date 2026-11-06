import BN from "bn.js";

/** Same integer floor as fund_native_gauge; never extrapolate a late stream. */
export function gaugeEmissionAllocation(budget: BN, weight: BN, total: BN): BN {
	if (budget.isNeg() || weight.isNeg() || total.isNeg() || weight.gt(total)) {
		throw new Error("Invalid gauge emission allocation");
	}
	return total.isZero() ? new BN(0) : budget.mul(weight).div(total);
}
