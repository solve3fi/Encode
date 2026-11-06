import css from "./Beta.module.css";

/** Horizontal step flow with animated connectors (stacks vertically on phones). Illustration only. */
export const StepFlow = ({
	steps,
	label,
}: {
	steps: readonly { title: string; text: string; tag?: string }[];
	label: string;
}) => (
	<ol className={css.flow} aria-label={label}>
		{steps.map((s, i) => (
			<li key={s.title} className={css.flowItem}>
				<div className={css.flowNode}>
					<span className={css.flowNum}>{String(i + 1).padStart(2, "0")}</span>
					<h3>{s.title}</h3>
					<p>{s.text}</p>
					{s.tag ? <small className={css.flowTag}>{s.tag}</small> : null}
				</div>
				{i < steps.length - 1 ? (
					<span className={css.flowLink} aria-hidden="true">
						<i />
					</span>
				) : null}
			</li>
		))}
	</ol>
);

const MARKETS = ["Jupiter Lend", "Kamino", "MarginFi", "Save"] as const;

/** Animated SVG of the planned Yield Hunter money flow. Illustration only: no live data. */
export const YieldFlow = () => (
	<figure className={css.figure}>
		<svg
			viewBox="0 0 900 380"
			role="img"
			aria-label="Planned flow: you deposit USDC into the Yield Hunter vault, a keeper moves the vault's USDC between Solana lending markets, and withdrawals return USDC to your wallet."
			className={css.flowSvg}
		>
			<defs>
				<linearGradient id="yhLine" x1="0" x2="1">
					<stop offset="0" stopColor="#58d7ff" />
					<stop offset="1" stopColor="#8c84ff" />
				</linearGradient>
				<filter id="yhGlow" x="-20%" y="-20%" width="140%" height="140%">
					<feGaussianBlur stdDeviation="6" result="b" />
					<feMerge>
						<feMergeNode in="b" />
						<feMergeNode in="SourceGraphic" />
					</feMerge>
				</filter>
			</defs>

			{/* deposit: wallet -> vault */}
			<path d="M190 190 H300" className={css.pathBase} />
			<path d="M190 190 H300" className={css.pathFlow} />
			{/* withdraw: vault -> wallet (below) */}
			<path d="M330 232 C330 330 120 330 120 232" className={css.pathBase} />
			<path d="M330 232 C330 330 120 330 120 232" className={`${css.pathFlow} ${css.pathBack}`} />
			{/* keeper -> vault */}
			<path d="M400 96 V150" className={css.pathBase} />
			<path d="M400 96 V150" className={`${css.pathFlow} ${css.pathKeeper}`} />
			{/* vault -> markets */}
			{MARKETS.map((m, i) => {
				const y = 56 + i * 90;
				const d = `M500 190 C580 190 580 ${y + 26} 650 ${y + 26}`;
				return (
					<g key={m}>
						<path d={d} className={css.pathBase} />
						<path d={d} className={css.pathFlow} style={{ animationDelay: `${i * 0.35}s` }} />
					</g>
				);
			})}

			{/* nodes */}
			<g>
				<rect x="40" y="150" width="150" height="82" rx="16" className={css.nodeBox} />
				<text x="115" y="184" textAnchor="middle" className={css.nodeTitle}>
					Your wallet
				</text>
				<text x="115" y="208" textAnchor="middle" className={css.nodeSub}>
					USDC · you sign
				</text>
			</g>
			<g filter="url(#yhGlow)">
				<rect x="300" y="150" width="200" height="82" rx="16" className={css.nodeVault} />
				<text x="400" y="184" textAnchor="middle" className={css.nodeTitle}>
					Yield Hunter vault
				</text>
				<text x="400" y="208" textAnchor="middle" className={css.nodeSub}>
					on-chain program
				</text>
			</g>
			<g>
				<rect x="262" y="26" width="276" height="70" rx="16" className={css.nodeBox} />
				<text x="400" y="56" textAnchor="middle" className={css.nodeTitle}>
					Keeper
				</text>
				<text x="400" y="78" textAnchor="middle" className={css.nodeSub}>
					compares markets · dry-run first
				</text>
			</g>
			{MARKETS.map((m, i) => (
				<g key={m}>
					<rect x="650" y={56 + i * 90} width="210" height="52" rx="14" className={css.nodeBox} />
					<text x="755" y={88 + i * 90} textAnchor="middle" className={css.nodeTitle}>
						{m}
					</text>
				</g>
			))}
			<text x="755" y="30" textAnchor="middle" className={css.nodeSub}>
				Planned lending markets
			</text>
			<text x="225" y="318" textAnchor="middle" className={css.nodeSub}>
				withdraw
			</text>
			<text x="245" y="178" textAnchor="middle" className={css.nodeSub}>
				deposit
			</text>
		</svg>
		<figcaption className={css.fine}>Illustration of the planned flow. Not live, and the list of lending markets may change.</figcaption>
	</figure>
);
