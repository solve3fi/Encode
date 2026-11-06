"use client";

import { useEffect, useState } from "react";
import { INTENTS_DESTINATION_SYMBOLS } from "@/configs/intents";
import { fromBaseUnits } from "@/lib/intents/amount";
import { INTENTS_CHAINS, resolveChain } from "@/lib/intents/chains";
import classes from "./Fund.module.css";
import { ChainChips, CopyButton, short } from "./shared";
import { api } from "./useFund";

const SOURCE_CHAINS = INTENTS_CHAINS.filter((c) => c.slug !== "sol");

type Address = {
	depositAddress: string;
	memo: string | null;
	alreadyExisted: boolean;
	chain: { slug: string; label: string; network: string };
	destinationAsset: string;
};
type Deposit = {
	txHash: string;
	fromChain: string | null;
	amount: string;
	decimals: number | null;
	createdAt: string;
};

/**
 * A persistent address for the connected wallet. It keeps working: send from the chosen chain at any time and the funds
 * are swapped and delivered to the same Solana wallet. Good for topping up again without a new quote each time.
 */
export const DepositAddress: React.FC<{
	initialChain?: string;
	initialTo?: string;
	/** The connected Solana wallet (funds are delivered here). */
	wallet?: string;
}> = ({ initialChain, initialTo, wallet }) => {
	const [chain, setChain] = useState(
		resolveChain(initialChain ?? "")?.slug ?? "base",
	);
	const [asset, setAsset] = useState<string>(
		(INTENTS_DESTINATION_SYMBOLS as readonly string[]).includes(
			(initialTo ?? "").toUpperCase(),
		)
			? (initialTo ?? "").toUpperCase()
			: "USDC",
	);
	const [result, setResult] = useState<Address | null>(null);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	// A different wallet, chain or asset means a different address.
	// biome-ignore lint/correctness/useExhaustiveDependencies: reset on any selector change
	useEffect(() => {
		setResult(null);
		setError(null);
	}, [wallet, chain, asset]);

	async function show() {
		if (!wallet) return;
		setBusy(true);
		setError(null);
		try {
			setResult(
				await api<Address>("/api/intents/deposit-address", {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						depositChain: chain,
						destinationAsset: asset,
						recipient: wallet,
					}),
				}),
			);
		} catch (e) {
			setError(e instanceof Error ? e.message : "Could not get your address.");
		} finally {
			setBusy(false);
		}
	}

	return (
		<div className={classes.card}>
			<h2 className={classes.h2}>Your deposit address</h2>
			<p className={classes.lede}>
				One address you can reuse. Send from the chain you pick and it arrives
				in your Solana wallet as {asset}.
			</p>

			<span className={classes.label}>Send from</span>
			<ChainChips
				chains={SOURCE_CHAINS}
				value={chain}
				onChange={setChain}
				label="Deposit chain"
			/>

			<span className={classes.label}>Receive on Solana</span>
			<div
				className={classes.chips}
				role="radiogroup"
				aria-label="Receive asset"
			>
				{INTENTS_DESTINATION_SYMBOLS.map((symbol) => (
					// biome-ignore lint/a11y/useSemanticElements: styled chip group
					<button
						key={symbol}
						type="button"
						role="radio"
						aria-checked={asset === symbol}
						className={classes.chip}
						onClick={() => setAsset(symbol)}
					>
						{symbol}
					</button>
				))}
			</div>

			{error && <p className={classes.error}>{error}</p>}
			{!result && (
				<button
					type="button"
					className={classes.primary}
					disabled={!wallet || busy}
					onClick={() => void show()}
				>
					{wallet
						? busy
							? "Getting your address…"
							: "Show my address"
						: "Connect a wallet first"}
				</button>
			)}

			{result && (
				<>
					<div className={classes.address}>
						<span className={classes.label}>
							Deposit address ({result.chain.network} network)
							{result.alreadyExisted ? " · yours from before" : ""}
						</span>
						<code className={classes.code}>{result.depositAddress}</code>
						<CopyButton
							value={result.depositAddress}
							label="Copy deposit address"
						/>
					</div>
					{result.memo && (
						<div className={classes.address}>
							<span className={classes.label}>
								Memo (required, deposits without it are not credited)
							</span>
							<code className={classes.code}>{result.memo}</code>
							<CopyButton value={result.memo} label="Copy memo" />
						</div>
					)}
					<ul className={classes.rules}>
						<li>
							Send supported assets on the{" "}
							<strong>{result.chain.network}</strong> network only. Another
							asset or network may be lost.
						</li>
						<li>
							You receive {result.destinationAsset} in{" "}
							{short(wallet ?? "", 6, 4)} on Solana. Small deposits may be below
							the minimum and be refunded.
						</li>
						<li>
							Fees and the exact amount are set when the deposit arrives; check
							the amount received below.
						</li>
					</ul>
					<Deposits address={result.depositAddress} />
				</>
			)}
			<p className={classes.fine}>
				Solve3 never holds your funds. Anyone with this address can send to it;
				funds always go to your wallet.
			</p>
		</div>
	);
};

const Deposits: React.FC<{ address: string }> = ({ address }) => {
	const [rows, setRows] = useState<{ d: Deposit; kind: string }[]>([]);
	useEffect(() => {
		let alive = true;
		async function load() {
			try {
				const [seen, done] = await Promise.all([
					api<{ deposits: Deposit[] }>(
						`/api/intents/deposits?address=${encodeURIComponent(address)}&type=received`,
					),
					api<{ deposits: Deposit[] }>(
						`/api/intents/deposits?address=${encodeURIComponent(address)}&type=success`,
					),
				]);
				const finished = new Set(done.deposits.map((x) => x.txHash));
				if (alive)
					setRows(
						seen.deposits.map((d) => ({
							d,
							kind: finished.has(d.txHash) ? "Delivered" : "Processing",
						})),
					);
			} catch {
				/* the list is a convenience; the address itself keeps working */
			}
		}
		void load();
		const timer = window.setInterval(() => {
			if (document.visibilityState !== "hidden") void load();
		}, 15000);
		return () => {
			alive = false;
			window.clearInterval(timer);
		};
	}, [address]);
	return (
		<div className={classes.deposits} aria-live="polite">
			<span className={classes.label}>Recent deposits</span>
			{rows.length === 0 ? (
				<span className={classes.muted}>
					Nothing yet. This updates by itself.
				</span>
			) : (
				<ul className={classes.facts}>
					{rows.map(({ d, kind }) => (
						<li key={d.txHash}>
							{fromBaseUnits(d.amount, d.decimals ?? 6, 6)} from{" "}
							{d.fromChain ?? "another chain"} · {kind} ·{" "}
							{short(d.txHash, 8, 4)}
						</li>
					))}
				</ul>
			)}
		</div>
	);
};
