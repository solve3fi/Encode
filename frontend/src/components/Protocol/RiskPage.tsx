import Link from "next/link";
import { Footer } from "@/components/Footer";
import { Header } from "@/components/Header";
import { AUDIT_URL } from "@/configs/audit";
import styles from "./LegalPage.module.css";

type Role = { name: string; holder: string; can: string; cannot: string };

// Verified on-chain on 2026-10-05 (Devnet). Re-verify and update before any mainnet launch.
const ROLES: Role[] = [
	{
		name: "Program upgrade authority (all three programs)",
		holder:
			"4j3VFftvWC4R2KxbF4R8bJKz2Mxk3m6a2RjkEu8ySVPs, a single team-held key",
		can: "Replace the code of the SOLV3 token, vesolve (governance) and solve (DEX) programs at any time, with no delay.",
		cannot:
			"Nothing on-chain limits it today. This is the largest trust assumption. A 24-hour upgrade timelock is built into vesolve and has been tested, but control has not been handed to it yet.",
	},
	{
		name: "Protocol admin and DEX fee authorities",
		holder:
			"HGUPXpPUhD6PiTSWexebRSsgCT1uDAgiKk2DvdRHsq6o (the epoch keeper's server key)",
		can: "Advance epochs, route pool fees to gauges, fund emissions, set the emission rate and change pool fee policy.",
		cannot:
			"Mint SOLV3 outside the program's rules or upgrade programs. The keeper stops without acting if its authority checks fail.",
	},
	{
		name: "DEX reward-emissions super authority",
		holder: "4j3VFftvWC4R2KxbF4R8bJKz2Mxk3m6a2RjkEu8ySVPs",
		can: "Control which pools carry SOLV3 reward emissions on the DEX.",
		cannot: "Change the weekly budget or take earned rewards from LPs.",
	},
	{
		name: "SOLV3 mint and freeze authority",
		holder: "Program-derived accounts. No private key exists for either.",
		can: "Mint only through the token program's rules.",
		cannot: "Be used by a person to freeze a wallet or mint arbitrarily.",
	},
];

export const RiskPage = () => (
	<div className={styles.page}>
		<Header variant="marketing" />
		<main className={styles.main}>
			<p className={styles.label}>Solve3 risk</p>
			<h1>Risk and admin roles</h1>
			<div className={styles.notice}>
				<p>Last verified on-chain: October 5, 2026 (Devnet).</p>
				<p>
					Solve3 is running on Solana devnet. Test tokens have no monetary
					value. This page will be re-verified and updated before any mainnet
					launch.
				</p>
				<p>
					Contact: <a href="mailto:admin@solve3.fi">admin@solve3.fi</a>
				</p>
			</div>
			<nav className={styles.navigation} aria-label="Related pages">
				<Link href="/charter">Charter</Link>
				<a href={AUDIT_URL} target="_blank" rel="noopener noreferrer">
					Audit report
				</a>
				<Link href="/legal">Legal disclosures</Link>
			</nav>

			<section className={styles.section}>
				<h2>Who can change what</h2>
				<p>
					These are the keys that can affect the protocol today. You can check
					each one yourself: the program upgrade authority is shown on any
					Solana explorer under the program account, and the token authorities
					under the SOLV3 mint.
				</p>
				{ROLES.map((role) => (
					<div key={role.name}>
						<h3>{role.name}</h3>
						<p>
							<strong>Held by:</strong> {role.holder}
						</p>
						<p>
							<strong>Can:</strong> {role.can}
						</p>
						<p>
							<strong>Cannot:</strong> {role.cannot}
						</p>
					</div>
				))}
			</section>

			<section className={styles.section}>
				<h2>What the audit covers</h2>
				<p>
					LedgerOps assessed the ve(3,3) governance programs (the SOLVE token,
					the core ve(3,3) logic and the veSOLVE vote-escrow NFT) between
					February 16 and February 27, 2026, and validated the fixes on May 13,
					2026. All eight findings (four high, two medium, one low, one
					informational) are marked closed.{" "}
					<a href={AUDIT_URL} target="_blank" rel="noopener noreferrer">
						Read the report
					</a>
					.
				</p>
				<p>
					It does not cover the swap program. That program is a fork of Orca
					Whirlpools under Apache 2.0. Orca's audits cover Orca's code. Solve3's
					additions to it (gauge emissions, activity gates, trading pauses and
					position events) have not been independently audited. The off-chain
					keeper and this website were also out of scope.
				</p>
			</section>

			<section className={styles.section}>
				<h2>Known risks</h2>
				<ul>
					<li>
						Upgrade key: a single key can replace program code until control
						moves to the timelock.
					</li>
					<li>
						Keeper key: epoch settlement depends on an off-chain server key. If
						it is offline, epochs and fee routing pause. If it were stolen, the
						attacker could run the admin actions listed above. The audit
						recommended secure key storage and multisignature authority for
						these actions.
					</li>
					<li>
						Unaudited DEX changes: bugs in Solve3's additions to the swap
						program could affect pools, fees or emissions.
					</li>
					<li>
						Liquidity: positions can lose value against simply holding the
						tokens and stop earning fees when the price leaves their range. A
						price range that nobody has used yet needs new tick arrays, a
						one-time rent of about 0.05 SOL each.
					</li>
					<li>
						Programs are upgradeable and the protocol is new. Do not deposit
						more than you can afford to lose.
					</li>
				</ul>
			</section>

			<section className={styles.section}>
				<h2>Reporting a problem</h2>
				<p>
					Email <a href="mailto:admin@solve3.fi">admin@solve3.fi</a>. Please do
					not disclose vulnerabilities publicly before we have had a chance to
					fix them.
				</p>
			</section>
		</main>
		<Footer variant="marketing" />
	</div>
);
