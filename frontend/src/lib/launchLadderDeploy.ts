// Pure checks for deploying the launch ladder. No imports on purpose: the
// deploy panel feeds it plain data (the saved plan's deploy JSON and what it
// read back from chain), so the same logic can be unit-tested without a
// wallet or an RPC.

export type DeployPlan = {
	pool: {
		tokenMintA: string;
		tokenMintB: string;
		feeRate: number;
		tickSpacing: number;
		initialTickIndex: number;
	};
	tickArrayStartIndices: number[];
	positions: {
		band: string;
		tickLowerIndex: number;
		tickUpperIndex: number;
		tokenAAmount: string;
		tokenMaxB: string;
		expectedLiquidity: string;
	}[];
	floorPosition: {
		tickLowerIndex: number;
		tickUpperIndex: number;
		tokenBAmount: string;
		tokenMaxA: string;
		expectedLiquidity: string;
	} | null;
};

export type Check = { label: string; ok: boolean; detail: string };

const TICK_ARRAY_SIZE = 88;

// Liquidity in the plan comes from float math, on chain it comes from integer
// Q64 math, so allow a tiny relative difference — nothing like a wrong tick.
const LIQUIDITY_REL_TOLERANCE = 1e-6;

const ok = (label: string, detail = ""): Check => ({
	label,
	ok: true,
	detail,
});
const bad = (label: string, detail: string): Check => ({
	label,
	ok: false,
	detail,
});
const check = (label: string, pass: boolean, detail: string): Check =>
	pass ? ok(label, detail) : bad(label, detail);

export const tickArrayStartOf = (tick: number, spacing: number) => {
	const span = TICK_ARRAY_SIZE * spacing;
	return Math.floor(tick / span) * span;
};

const relDiff = (a: bigint, b: bigint) => {
	if (a === b) return 0;
	const diff = a > b ? a - b : b - a;
	const base = b === BigInt(0) ? BigInt(1) : b;
	return Number((diff * BigInt(1_000_000_000)) / base) / 1_000_000_000;
};

const safeBig = (value: string) => {
	try {
		return BigInt(value);
	} catch {
		return null;
	}
};

/** Everything that can be wrong with the plan itself, before touching chain. */
export function checkPlan(plan: DeployPlan): Check[] {
	const checks: Check[] = [];
	const spacing = plan.pool.tickSpacing;
	const bands = plan.positions;

	checks.push(
		check(
			"Three single-sided SOLV3 bands",
			bands.length === 3,
			`${bands.length} band(s) in the plan`,
		),
	);

	const aligned = bands.every(
		(b) => b.tickLowerIndex % spacing === 0 && b.tickUpperIndex % spacing === 0,
	);
	checks.push(
		check(
			"Every position tick is a multiple of the tick spacing",
			aligned && spacing > 0,
			`spacing ${spacing}`,
		),
	);

	const contiguous = bands.every(
		(b, i) =>
			b.tickLowerIndex < b.tickUpperIndex &&
			(i === 0 || b.tickLowerIndex === bands[i - 1].tickUpperIndex),
	);
	checks.push(
		check(
			"Bands are ascending and touch end to end",
			contiguous,
			bands.map((b) => `${b.tickLowerIndex}→${b.tickUpperIndex}`).join("  "),
		),
	);

	checks.push(
		check(
			"Pool initializes strictly below the first band",
			bands.length > 0 && plan.pool.initialTickIndex < bands[0].tickLowerIndex,
			`init tick ${plan.pool.initialTickIndex}, first band ${bands[0]?.tickLowerIndex}`,
		),
	);

	const amounts = bands.map((b) => safeBig(b.tokenAAmount));
	checks.push(
		check(
			"Each band deposits a positive SOLV3 amount and no USDC",
			amounts.every((a) => a !== null && a > BigInt(0)) &&
				bands.every((b) => safeBig(b.tokenMaxB) === BigInt(0)),
			"token_max_b = 0 on every band",
		),
	);

	const needed = new Set<number>();
	for (const b of bands) {
		needed.add(tickArrayStartOf(b.tickLowerIndex, spacing));
		needed.add(tickArrayStartOf(b.tickUpperIndex, spacing));
	}
	checks.push(
		check(
			"Tick array list covers every band endpoint",
			[...needed].every((s) => plan.tickArrayStartIndices.includes(s)),
			`needs ${[...needed].sort((x, y) => x - y).join(", ")}`,
		),
	);

	checks.push(
		check(
			"No USDC floor in this deploy",
			plan.floorPosition === null,
			plan.floorPosition
				? "the panel only deploys the three SOLV3 bands; remove the floor from the plan"
				: "floor disabled",
		),
	);

	return checks;
}

export const totalFloatRaw = (plan: DeployPlan) =>
	plan.positions.reduce((sum, b) => sum + BigInt(b.tokenAAmount), BigInt(0));

/** Stable fingerprint of what actually gets deployed (mints excluded so a
 * devnet rehearsal with test mints matches the mainnet plan). */
export const planFingerprintSource = (plan: DeployPlan) =>
	JSON.stringify([
		plan.pool.tickSpacing,
		plan.pool.initialTickIndex,
		plan.positions.map((b) => [
			b.tickLowerIndex,
			b.tickUpperIndex,
			b.tokenAAmount,
			b.expectedLiquidity,
		]),
	]);

export type ChainReadback = {
	mintA: string;
	mintB: string;
	tickSpacing: number;
	tickCurrentIndex: number;
	// sqrtPrice read from the pool and the value the SDK computes for the
	// plan's initial tick.
	sqrtPrice: bigint;
	expectedSqrtPrice: bigint;
	poolLiquidity: bigint;
	vaultA: bigint;
	vaultB: bigint;
	positions: {
		mint: string;
		tickLower: number;
		tickUpper: number;
		liquidity: bigint;
	}[];
};

/** Compares what chain holds against the plan. Run after the last step. */
export function evaluateReadback(
	plan: DeployPlan,
	chain: ChainReadback,
): Check[] {
	const checks: Check[] = [];

	checks.push(
		check(
			"Pool token A is SOLV3 (mint ordering matches the plan)",
			chain.mintA === plan.pool.tokenMintA,
			`A ${chain.mintA}`,
		),
	);
	checks.push(
		check(
			"Pool token B is USDC",
			chain.mintB === plan.pool.tokenMintB,
			`B ${chain.mintB}`,
		),
	);
	checks.push(
		check(
			"Tick spacing matches the plan",
			chain.tickSpacing === plan.pool.tickSpacing,
			`${chain.tickSpacing}`,
		),
	);
	checks.push(
		check(
			"Pool price is the planned launch tick",
			chain.sqrtPrice === chain.expectedSqrtPrice &&
				chain.tickCurrentIndex === plan.pool.initialTickIndex,
			`tick ${chain.tickCurrentIndex}, plan ${plan.pool.initialTickIndex}`,
		),
	);
	checks.push(
		check(
			"Pool in-range liquidity is 0 (nothing active below the first band)",
			chain.poolLiquidity === BigInt(0),
			chain.poolLiquidity.toString(),
		),
	);

	const floatRaw = totalFloatRaw(plan);
	const vaultDiff = relDiff(chain.vaultA, floatRaw);
	checks.push(
		check(
			"SOLV3 vault holds the whole float",
			vaultDiff <= LIQUIDITY_REL_TOLERANCE,
			`${chain.vaultA} vs plan ${floatRaw}`,
		),
	);
	checks.push(
		check(
			"USDC vault is empty",
			chain.vaultB === BigInt(0),
			chain.vaultB.toString(),
		),
	);

	checks.push(
		check(
			"One position per band, no extras",
			chain.positions.length === plan.positions.length,
			`${chain.positions.length} on chain, ${plan.positions.length} planned`,
		),
	);

	for (const planned of plan.positions) {
		const found = chain.positions.find(
			(p) =>
				p.tickLower === planned.tickLowerIndex &&
				p.tickUpper === planned.tickUpperIndex,
		);
		if (!found) {
			checks.push(
				bad(
					`${planned.band} band position`,
					`no position at ${planned.tickLowerIndex}→${planned.tickUpperIndex}`,
				),
			);
			continue;
		}
		const expected = BigInt(planned.expectedLiquidity);
		const diff = relDiff(found.liquidity, expected);
		checks.push(
			check(
				`${planned.band} band position`,
				diff <= LIQUIDITY_REL_TOLERANCE,
				`${found.mint} · liquidity ${found.liquidity} vs ${expected}`,
			),
		);
	}

	return checks;
}

export const allPassed = (checks: Check[]) =>
	checks.length > 0 && checks.every((c) => c.ok);
