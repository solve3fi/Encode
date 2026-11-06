"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import BN from "bn.js";
import Link from "next/link";
import { useMemo, useState } from "react";
import { SOLVE } from "@/configs/tokens";
import { useClaimAllRewards } from "@/hooks/useClaimAllRewards";
import { usePartnerPoolStatus } from "@/hooks/usePartnerPoolStatus";
import { usePartnerSpaceAccess } from "@/hooks/usePartnerSpaceAccess";
import { useAllTokens } from "@/hooks/useToken";
import { useVoteRewards } from "@/hooks/useVoteRewards";
import { formatAddress } from "@/lib/format";
import { useCluster } from "@/providers/ClusterProvider";
import { useLocks } from "@/stores/lock/hooks/useLocks";
import { ModalType } from "@/stores/modal";
import { useModalActions } from "@/stores/modal/ModalProvider";
import { useVoteConfig } from "@/stores/vote/hooks/useVoteConfig";
import classes from "./PartnerSpace.module.css";
import { PartnerAutoVote } from "./PartnerAutoVote";
import { PartnerClaimLock } from "./PartnerClaimLock";
import { PartnerLockMore } from "./PartnerLockMore";

const units = (raw: BN | undefined, decimals: number) =>
	Number(raw?.toString() ?? "0") / 10 ** decimals;
const fmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 4 });

export const PartnerSpace: React.FC<{ slug: string }> = ({ slug }) => {
	const { publicKey } = useWallet();
	const { setOpenModal } = useModalActions();
	const { network } = useCluster();
	const tokens = useAllTokens();
	const { data: voteConfig } = useVoteConfig(network);
	const { data: locks } = useLocks();
	const { data: rewards, isLoading: rewardsLoading } = useVoteRewards();
	const { mutate: claimAll, isPending: claiming } = useClaimAllRewards();

	const wallet = publicKey?.toBase58();
	const access = usePartnerSpaceAccess(slug);
	const space = access.space;
	const pool = usePartnerPoolStatus(space);

	const [copied, setCopied] = useState(false);

	const rows = useMemo(() => {
		const byEpoch = new Map<number, { fees: string[]; emissions: number }>();
		for (const row of rewards ?? []) {
			const entry = byEpoch.get(row.epoch) ?? { fees: [], emissions: 0 };
			const a = tokens[row.tokenMintA.toString()];
			const b = tokens[row.tokenMintB.toString()];
			if (a && !row.poolRewardAmountA.isZero()) entry.fees.push(`${fmt(units(row.poolRewardAmountA, a.decimals))} ${a.symbol}`);
			if (b && !row.poolRewardAmountB.isZero()) entry.fees.push(`${fmt(units(row.poolRewardAmountB, b.decimals))} ${b.symbol}`);
			for (const bribe of row.bribes) {
				const token = tokens[bribe.mint.toString()];
				if (token && !bribe.amount.isZero()) entry.fees.push(`${fmt(units(bribe.amount, token.decimals))} ${token.symbol}`);
			}
			entry.emissions += units(row.rewardAmount, SOLVE.decimals);
			byEpoch.set(row.epoch, entry);
		}
		return [...byEpoch.entries()].sort((x, y) => y[0] - x[0]);
	}, [rewards, tokens]);

	const epoch = voteConfig?.epoch.toNumber();
	const voted = (locks ?? []).some((item) => item.used);
	const link = typeof window !== "undefined" && space ? `${window.location.origin}/partner/${space.slug}` : "";

	if (!publicKey) {
		return (
			<div className={classes.page}>
				<header className={classes.head}>
					<span className={classes.eyebrow}>Partner space</span>
					<h1>Your launch, <span className={classes.grad}>in one place.</span></h1>
					<p>This page is private to the wallets your team registered with Solve3. Connect one of them to continue.</p>
					<button type="button" className={classes.primary} onClick={() => setOpenModal(ModalType.WALLET)}>Connect wallet</button>
				</header>
			</div>
		);
	}

	if (access.status === "checking" || access.status === "signing") {
		return (
			<div className={classes.page}>
				<p className={classes.muted} role="status">
					{access.status === "signing" ? "Approve the message in your wallet to open your partner space…" : "Checking your wallet…"}
				</p>
			</div>
		);
	}

	if (access.status !== "ready" || !space) {
		return (
			<div className={classes.page}>
				<header className={classes.head}>
					<span className={classes.eyebrow}>Partner space</span>
					{access.status === "denied" ? (
						<>
							<h1>This link is not available for this wallet.</h1>
							<p>
								Partner spaces open only for the wallets registered with Solve3, and only through your private link. Connect a registered wallet, or ask us to update your list.
							</p>
						</>
					) : (
						<>
							<h1>Prove it is your wallet.</h1>
							<p>Sign one free message to open your partner space. Nothing is sent on-chain and no funds move.</p>
						</>
					)}
					{access.error && <p className={classes.muted} role="alert">{access.error}</p>}
					<div className={classes.actions}>
						{access.status !== "denied" && (
							<button type="button" className={classes.primary} disabled={!access.canSign} onClick={() => void access.verify()}>
								Sign to open
							</button>
						)}
						<a className={classes.ghost} href="mailto:admin@solve3.fi">Contact Solve3</a>
					</div>
					{!access.canSign && <p className={classes.muted}>This wallet does not support message signing.</p>}
				</header>
			</div>
		);
	}

	const listing = {
		name: space.listing?.name ?? space.projectName,
		symbol: space.listing?.symbol ?? "",
		mint: space.mint,
	};
	const accelerator = space.accelerator;
	const acceleratorEpochsLeft = accelerator && epoch !== undefined
		? Math.max(0, accelerator.maxEpochs - Math.max(0, epoch - accelerator.enrolledAtEpoch))
		: null;

	const path: Array<[string, string, string]> = [
		["Done", "Whitelisted", "Your token is on the Solve3 list."],
		[pool.poolAddress ? "Done" : "Next", "Seed a pool", pool.poolAddress ? `Live: ${pool.poolLabel}.` : "Create your pool and add liquidity."],
		[pool.gaugeActive ? "Done" : "Next", "Gauge active", pool.gaugeActive ? "Voters can steer rewards to your pool." : `Gauge status: ${pool.gaugeLabel}.`],
		[voted ? "Done" : "Next", "Lock and vote", "Put voting power behind your gauge each epoch."],
		["Later", "Day-30 readout", "Review growth and decide whether to scale."],
	];

	return (
		<div className={classes.page}>
			<header className={classes.top}>
				<div className={classes.head}>
					<span className={classes.eyebrow}>Partner space</span>
					<h1>{listing.name}</h1>
					<div className={classes.pills}>
						<span>{listing.symbol || "Token"}</span>
						<span className={classes.badge}>Whitelisted</span>
						<span className={classes.badge}>{pool.gaugeLabel}</span>
					</div>
				</div>
				<div className={classes.link}>
					<span className={classes.eyebrow}>Private partner link</span>
					<div>
						<code>{link.replace(/^https?:\/\//, "")}</code>
						<button
							type="button"
							className={classes.ghost}
							onClick={() => {
								navigator.clipboard.writeText(link).then(() => {
									setCopied(true);
									window.setTimeout(() => setCopied(false), 1500);
								});
							}}
						>
							{copied ? "Copied" : "Copy"}
						</button>
					</div>
				</div>
			</header>

			{space.note && (
				<section className={classes.panel} aria-label="Message from Solve3">
					<div><h2>A note from Solve3</h2><p>{space.note}</p></div>
				</section>
			)}

			<div className={classes.tiles}>
				<div>
					<span>Gauge</span>
					<strong>{pool.loading ? "…" : pool.gaugeLabel}</strong>
					<small>{pool.poolLabel ?? "No pool found for your token yet"}</small>
				</div>
				<div>
					<span>Vote share</span>
					<strong>{pool.voteSharePct === null ? "—" : `${pool.voteSharePct.toFixed(2)}%`}</strong>
					<small>{epoch ? `Of all votes in epoch ${epoch}` : "Of all votes this epoch"}</small>
				</div>
				<div>
					<span>Accelerator</span>
					<strong>{!accelerator ? "Not enrolled" : accelerator.status === "active" ? "Enrolled" : accelerator.status === "completed" ? "Completed" : "Ended"}</strong>
					<small>
						{accelerator?.status === "active" && acceleratorEpochsLeft !== null
							? `${acceleratorEpochsLeft} of ${accelerator.maxEpochs} epochs left`
							: "Matched votes for qualifying pools"}
					</small>
				</div>
				<div><span>Claimable epochs</span><strong>{rows.length}</strong><small>Voting rewards ready to claim · current epoch {epoch ?? "—"}</small></div>
			</div>

			<div className={classes.columns}>
				<section className={classes.panel} aria-label="Claim rewards">
					<div className={classes.panelHead}>
						<div>
							<h2>Claim rewards</h2>
							<p>Rewards by epoch, collected with one wallet confirmation. Rewards for votes in epoch N are claimable from epoch N+1.</p>
						</div>
						<button type="button" className={classes.primary} disabled={claiming || rows.length === 0} onClick={() => claimAll()}>
							{claiming ? "Confirm in wallet…" : "Claim all"}
						</button>
					</div>
					<div className={classes.tableWrap}>
						<div role="table" aria-label="Rewards by epoch" className={classes.table}>
							<div role="row" className={`${classes.row} ${classes.rowHead}`}>
								<span role="columnheader">Epoch</span>
								<span role="columnheader">Fees + bribes</span>
								<span role="columnheader">SOLV3 emissions</span>
								<span role="columnheader">Status</span>
							</div>
							{rows.map(([n, entry]) => (
								<div role="row" className={classes.row} key={n}>
									<span role="cell">Epoch {n}</span>
									<span role="cell">{entry.fees.length ? entry.fees.join(" · ") : "—"}</span>
									<span role="cell">{fmt(entry.emissions)} SOLV3</span>
									<span role="cell"><span className={classes.status}>Claimable</span></span>
								</div>
							))}
						</div>
					</div>
					{rewardsLoading && <p className={classes.muted} role="status">Reading your voting rewards…</p>}
					{!rewardsLoading && rows.length === 0 && (
						<p className={classes.muted}>Amounts appear once the first voted epoch settles.</p>
					)}
				</section>

				<div className={classes.side}>
					<section className={classes.panel} aria-label="Partner wallets">
						<div>
							<h2>Your partner wallets</h2>
							<p>Only these wallets can open this space. To change them, contact Solve3.</p>
						</div>
						{space.wallets.map((address) => (
							<div className={classes.toggle} key={address}>
								<div>
									<strong style={{ fontFamily: "ui-monospace, monospace" }}>{formatAddress(address)}</strong>
									<small>{address === wallet ? "This wallet" : "Registered"}</small>
								</div>
							</div>
						))}
						<button type="button" className={classes.ghost} onClick={access.signOut}>Close this space on this device</button>
					</section>

					<PartnerAutoVote gaugeActive={pool.gaugeActive} gaugeLabel={pool.gaugeLabel} registeredWallets={space.wallets} />
					<PartnerClaimLock />

					<PartnerLockMore registeredWallets={space.wallets} />
				</div>
			</div>

			<section className={classes.panel} aria-label="Launch path">
				<h2>Your launch path</h2>
				<div className={classes.path}>
					{path.map(([state, title, sub]) => (
						<div key={title}>
							<span className={state === "Done" ? classes.done : classes.next}>{state}</span>
							<strong>{title}</strong>
							<small>{sub}</small>
						</div>
					))}
				</div>
			</section>

			<footer className={classes.foot}>
				<a href="mailto:admin@solve3.fi">admin@solve3.fi</a>
				<Link href="/partners/onboarding">Onboarding</Link>
				<a href="https://discord.gg/ZDyXeyjGc7">Discord</a>
			</footer>
		</div>
	);
};
