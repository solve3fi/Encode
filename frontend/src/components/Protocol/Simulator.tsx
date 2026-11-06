"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import styles from "./Simulator.module.css";

const INITIAL_EMISSION = 1_300_000;
const DECAY = 0.98;
// Preserve the deployed model's pool allocation; UI wording does not change tokenomics.
const GAUGE_SHARE = 0.96;

const PRESETS = {
	small: { label: "Small pool share", pool: 20, mine: 5 },
	def: { label: "Default example", pool: 50, mine: 10 },
	large: { label: "Larger pool share", pool: 75, mine: 25 },
} as const;
type PresetKey = keyof typeof PRESETS;

const DEFAULT_START = 2;
const DEFAULT_WEEKS = 12;

const fmt = (n: number) =>
	n.toLocaleString("en-US", {
		minimumFractionDigits: 2,
		maximumFractionDigits: 2,
	});
const parseNumber = (value: string) => {
	const n = Number.parseFloat(value.replace(/,/g, ""));
	return Number.isFinite(n) && n > 0 ? n : 0;
};
const clampInt = (value: string, min: number, max: number) =>
	Math.min(max, Math.max(min, Math.floor(parseNumber(value))));

export const Simulator = () => {
	const [preset, setPreset] = useState<PresetKey | "custom">("def");
	const [pool, setPool] = useState<number>(PRESETS.def.pool);
	const [mine, setMine] = useState<number>(PRESETS.def.mine);
	const [startText, setStartText] = useState(String(DEFAULT_START));
	const [weeksText, setWeeksText] = useState(String(DEFAULT_WEEKS));
	const [lockText, setLockText] = useState("10,000");
	const [totalLockedText, setTotalLockedText] = useState("1,000,000");

	const start = clampInt(startText, 0, 520);
	const weeks = clampInt(weeksText || "1", 1, 104) || 1;

	const model = useMemo(() => {
		const poolShare = pool / 100;
		const mineShare = mine / 100;
		const emission = (week: number) =>
			INITIAL_EMISSION * DECAY ** week * GAUGE_SHARE;
		const mineAt = (week: number) => emission(week) * poolShare * mineShare;
		let total = 0;
		const bars: { height: number; title: string }[] = [];
		const max = mineAt(start) || 1;
		for (let i = 0; i < weeks; i += 1) {
			const value = mineAt(start + i);
			total += value;
			bars.push({
				height: Math.max(4, Math.round((value / max) * 100)),
				title: `Week ${start + i}: ${fmt(value)} SOLV3`,
			});
		}
		const allPools = emission(start);
		const poolReward = allPools * poolShare;
		return {
			total,
			bars,
			allPools,
			poolReward,
			position: poolReward * mineShare,
			weeklyReward: poolReward * mineShare,
		};
	}, [pool, mine, start, weeks]);

	const locked = parseNumber(lockText);
	const totalLocked = parseNumber(totalLockedText);
	const votingShare =
		totalLocked > 0 ? Math.min(100, (locked / totalLocked) * 100) : 0;

	const apply = (key: PresetKey) => {
		setPreset(key);
		setPool(PRESETS[key].pool);
		setMine(PRESETS[key].mine);
		setStartText(String(DEFAULT_START));
		setWeeksText(String(DEFAULT_WEEKS));
	};
	const reset = () => {
		apply("def");
		setLockText("10,000");
		setTotalLockedText("1,000,000");
	};

	const funnel = [
		{
			label: "Emissions to all pools",
			value: model.allPools,
			width: 100,
			color: "#8c84ff",
		},
		{
			label: `Your pool (${pool}%)`,
			value: model.poolReward,
			width: Math.max(1, pool),
			color: "#58d7ff",
		},
		{
			label: `Your position (${mine}% of pool)`,
			value: model.position,
			width: Math.max(0.5, (pool * mine) / 100),
			color: "#f5b14c",
		},
	];

	return (
		<article className={styles.page}>
			<header className={styles.hero}>
				<span className={styles.eyebrow}>Rewards simulator</span>
				<h1>
					See what your votes <span className={styles.grad}>could earn.</span>
				</h1>
				<p>
					Model how a pool’s share of votes and your share of its liquidity turn
					into SOLV3 rewards. No wallet. No tokens move.
				</p>
			</header>

			<section aria-label="Simulator" className={styles.grid}>
				<div className={styles.card}>
					<div className={styles.cardHead}>
						<span className={styles.eyebrow}>Starting example</span>
						<div className={styles.chips} role="group" aria-label="Example settings">
							{(Object.keys(PRESETS) as PresetKey[]).map((key) => (
								<button
									key={key}
									type="button"
									aria-pressed={preset === key}
									className={styles.chip}
									onClick={() => apply(key)}
								>
									{PRESETS[key].label}
								</button>
							))}
						</div>
					</div>

					<Slider
						id="s-pool"
						label="Pool’s share of votes"
						value={pool}
						hint="The pool’s share of all votes, not just your own."
						onChange={(value) => {
							setPool(value);
							setPreset("custom");
						}}
					/>
					<Slider
						id="s-mine"
						label="Your share of staked liquidity"
						value={mine}
						hint="Your staked liquidity as a percentage of the pool’s total staked liquidity."
						onChange={(value) => {
							setMine(value);
							setPreset("custom");
						}}
					/>

					<div className={styles.pair}>
						<Field
							id="n-start"
							label="Starting week"
							value={startText}
							onChange={(value) => {
								setStartText(value);
								setPreset("custom");
							}}
							hint="Week 0 is the first emission week. Emissions decrease by 2% each week."
							type="number"
							min={0}
							max={520}
						/>
						<Field
							id="n-weeks"
							label="Number of weeks"
							value={weeksText}
							onChange={(value) => {
								setWeeksText(value);
								setPreset("custom");
							}}
							hint="Keep the same vote and liquidity shares over this period."
							type="number"
							min={1}
							max={104}
						/>
					</div>
					<button type="button" className={styles.reset} onClick={reset}>
						Reset
					</button>
				</div>

				<div className={styles.stack}>
					<div className={styles.total} role="status" aria-live="polite" aria-atomic="true">
						<span className={styles.eyebrowAlt}>Total over {weeks} weeks</span>
						<div className={`${styles.totalValue} ${styles.grad}`} data-testid="sim-total">
							{fmt(model.total)}
						</div>
						<span className={styles.totalUnit}>SOLV3 in liquidity rewards</span>
						<p>
							Your pool gets <b>{pool}%</b> of pool emissions. Your position gets{" "}
							<b>{mine}%</b> of that pool’s rewards.
						</p>
						<span hidden data-testid="sim-weekly">
							{fmt(model.weeklyReward)}
						</span>
					</div>

					<div className={styles.panel}>
						<span className={styles.eyebrow}>Week {start} breakdown</span>
						{funnel.map((row) => (
							<div key={row.label} className={styles.funnelRow}>
								<div>
									<span>{row.label}</span>
									<b>{fmt(row.value)} SOLV3</b>
								</div>
								<div className={styles.track}>
									<div
										className={styles.fill}
										style={{ width: `${row.width}%`, background: row.color }}
									/>
								</div>
							</div>
						))}
					</div>

					<div className={styles.panel}>
						<div className={styles.panelHead}>
							<span className={styles.eyebrow}>Weekly rewards</span>
							<span className={styles.muted}>Falls 2% each week</span>
						</div>
						<div className={styles.bars}>
							{model.bars.map((bar, index) => (
								<div
									// biome-ignore lint/suspicious/noArrayIndexKey: bars are positional
									key={index}
									title={bar.title}
									style={{ height: `${bar.height}%` }}
								/>
							))}
						</div>
						<div className={styles.axis}>
							<span>Week {start}</span>
							<span>Week {start + weeks - 1}</span>
						</div>
					</div>
				</div>
			</section>

			<section aria-label="Voting power" className={styles.grid}>
				<div className={styles.card}>
					<div className={styles.titleBlock}>
						<span className={styles.eyebrow}>Voting power estimator</span>
						<h2>How much of the vote is yours?</h2>
					</div>
					<div className={styles.pair}>
						<Field
							id="n-lock"
							label="Your locked SOLV3"
							value={lockText}
							onChange={setLockText}
							type="text"
							inputMode="numeric"
						/>
						<Field
							id="n-total"
							label="Total locked on Solve3"
							value={totalLockedText}
							onChange={setTotalLockedText}
							type="text"
							inputMode="numeric"
						/>
					</div>
					<p className={styles.hint}>
						Total includes your lock and everyone else’s. 1 SOLV3 locked = 1
						veSOLV3, and locks never decay.
					</p>
				</div>
				<div className={styles.vp} role="status" aria-live="polite">
					<span className={styles.eyebrow}>Your voting power share</span>
					<div className={`${styles.vpValue} ${styles.grad}`}>
						{votingShare.toFixed(2)}%
					</div>
					<div className={styles.vpTrack}>
						<div style={{ width: `${Math.max(0.5, votingShare)}%` }} />
					</div>
				</div>
			</section>

			<section aria-label="Notes" className={styles.notes}>
				<div className={styles.noteAmber}>
					<b>Practice only.</b> These are example amounts, not live pool data or
					guaranteed returns. No tokens move.
				</div>
				<div className={styles.noteCyan}>
					<b>SOLV3 emissions only.</b> It does not include token prices, trading
					fees, bribes, changes in liquidity value, transaction costs or
					lock-exit fees.
				</div>
				<div className={styles.noteViolet}>
					<b>Voters earn separately.</b> Voters share funded trading fees and
					bribes from the pools they vote for. Rewards from a vote in week N
					become claimable at the start of week N+1, and are not estimated here.
					See the <Link href="/charter">Charter</Link> for the full rules.
				</div>
			</section>
		</article>
	);
};

function Slider({
	id,
	label,
	value,
	hint,
	onChange,
}: {
	id: string;
	label: string;
	value: number;
	hint: string;
	onChange: (value: number) => void;
}) {
	return (
		<div className={styles.slider}>
			<div className={styles.sliderHead}>
				<label htmlFor={id}>{label}</label>
				<span>{value}%</span>
			</div>
			<input
				id={id}
				type="range"
				min={1}
				max={100}
				step={1}
				value={value}
				aria-describedby={`${id}-hint`}
				onChange={(event) => onChange(Number(event.target.value))}
			/>
			<p id={`${id}-hint`} className={styles.hint}>
				{hint}
			</p>
		</div>
	);
}

function Field({
	id,
	label,
	value,
	onChange,
	hint,
	type,
	min,
	max,
	inputMode,
}: {
	id: string;
	label: string;
	value: string;
	onChange: (value: string) => void;
	hint?: string;
	type: "number" | "text";
	min?: number;
	max?: number;
	inputMode?: "numeric";
}) {
	return (
		<div className={styles.field}>
			<label htmlFor={id}>{label}</label>
			<input
				id={id}
				type={type}
				min={min}
				max={max}
				inputMode={inputMode}
				value={value}
				aria-describedby={hint ? `${id}-hint` : undefined}
				onFocus={(event) => event.currentTarget.select()}
				onChange={(event) => onChange(event.target.value)}
			/>
			{hint && (
				<p id={`${id}-hint`} className={styles.hint}>
					{hint}
				</p>
			)}
		</div>
	);
}
