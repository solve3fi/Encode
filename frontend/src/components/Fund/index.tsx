"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { IconArrowUpRight } from "@tabler/icons-react";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { INTENTS_ENABLED } from "@/configs/intents";
import { ModalType } from "@/stores/modal";
import { useModalActions } from "@/stores/modal/ModalProvider";
import { DepositAddress } from "./DepositAddress";
import classes from "./Fund.module.css";
import { SwapOnce } from "./SwapOnce";
import { api, type FundToken } from "./useFund";

type TokensResponse = {
	configured: boolean;
	mock: boolean;
	tokens: FundToken[];
};

/**
 * "Fund from any chain": bring assets from 30+ chains into your Solana wallet through Aurora Intents (powered by NEAR
 * Intents). Two ways: a one-time swap with a quote, or a persistent deposit address. Nothing is signed or sent here.
 */
export const Fund: React.FC<{
	embedded?: boolean;
	useUrlPrefill?: boolean;
}> = ({ embedded = false, useUrlPrefill = true }) => {
	const params = useSearchParams();
	const { publicKey } = useWallet();
	const { setOpenModal } = useModalActions();
	const [tab, setTab] = useState<"swap" | "address">(
		useUrlPrefill && params.get("tab") === "address" ? "address" : "swap",
	);
	const [data, setData] = useState<TokensResponse | null>(null);
	// Development mock only: lets the screens be tried without a wallet extension. The server never reports mock in production.
	const wallet =
		publicKey?.toBase58() ??
		(data?.mock ? (params.get("previewWallet") ?? undefined) : undefined);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		if (!INTENTS_ENABLED) return;
		api<TokensResponse>("/api/intents/tokens")
			.then(setData)
			.catch((e) =>
				setError(e instanceof Error ? e.message : "Could not load assets."),
			);
	}, []);

	const header = (
		<header className={classes.hero}>
			<a
				className={classes.eyebrow}
				href="https://aurora.dev"
				target="_blank"
				rel="noopener noreferrer"
				aria-label="Powered by Aurora Intents (opens aurora.dev)"
			>
				<span className={classes.poweredBy}>Powered by</span>
				<span className={classes.badgeDivider} aria-hidden="true" />
				{/* biome-ignore lint/performance/noImgElement: a small fixed-size brand mark served from /public */}
				<img
					src="/brand/aurora-logo.svg"
					alt="Aurora"
					width={77}
					height={28}
					className={classes.auroraLogo}
				/>
				<span className={classes.badgeProduct}>Intents</span>
				<IconArrowUpRight
					size={15}
					stroke={2}
					className={classes.badgeArrow}
					aria-hidden="true"
				/>
			</a>
			<h1 className={classes.title}>
				{embedded ? "Move funds to Solana" : "Fund from any chain."}
			</h1>
			<p className={classes.heroText}>
				Hold ETH, BTC, USDC or NEAR on another chain? Send it from there and
				receive SOL or USDC in your Solana wallet. No bridge to learn, no extra
				steps.
			</p>
		</header>
	);

	if (!INTENTS_ENABLED) {
		return (
			<div
				className={
					embedded ? `${classes.page} ${classes.embedded}` : classes.page
				}
			>
				{header}
				<div className={classes.card}>
					<h2 className={classes.h2}>Coming soon</h2>
					<p className={classes.lede}>
						Cross-chain funding is being switched on. Check back shortly.
					</p>
				</div>
			</div>
		);
	}

	return (
		<div
			className={
				embedded ? `${classes.page} ${classes.embedded}` : classes.page
			}
		>
			{header}

			{!wallet && (
				<div className={classes.card}>
					<h2 className={classes.h2}>Connect your Solana wallet</h2>
					<p className={classes.lede}>
						Funds are delivered to the wallet you connect. You do not sign
						anything on this page.
					</p>
					<button
						type="button"
						className={classes.primary}
						onClick={() => setOpenModal(ModalType.WALLET)}
					>
						Connect wallet
					</button>
				</div>
			)}

			{error && <p className={classes.error}>{error}</p>}
			{data && !data.configured && (
				<div className={classes.card}>
					<h2 className={classes.h2}>Not available yet</h2>
					<p className={classes.lede}>
						Cross-chain funding is not connected on this deployment.
					</p>
				</div>
			)}
			{data?.mock && (
				<p className={classes.mock}>
					Development mock: responses are fake and nothing real is moved.
				</p>
			)}

			{data?.configured && wallet && (
				<>
					<div className={classes.tabs} role="tablist" aria-label="How to fund">
						<button
							type="button"
							role="tab"
							aria-selected={tab === "swap"}
							className={classes.tab}
							onClick={() => setTab("swap")}
						>
							Swap once
						</button>
						<button
							type="button"
							role="tab"
							aria-selected={tab === "address"}
							className={classes.tab}
							onClick={() => setTab("address")}
						>
							Deposit address
						</button>
					</div>
					{tab === "swap" ? (
						<SwapOnce
							wallet={wallet}
							tokens={data.tokens}
							prefill={{
								chain: (useUrlPrefill ? params.get("from") : null) ?? undefined,
								asset:
									(useUrlPrefill ? params.get("asset") : null) ?? undefined,
								amount:
									(useUrlPrefill ? params.get("amount") : null) ?? undefined,
								to: (useUrlPrefill ? params.get("to") : null) ?? undefined,
							}}
						/>
					) : (
						<DepositAddress
							wallet={wallet}
							initialChain={
								(useUrlPrefill ? params.get("from") : null) ?? undefined
							}
							initialTo={(useUrlPrefill ? params.get("to") : null) ?? undefined}
						/>
					)}
				</>
			)}
		</div>
	);
};
