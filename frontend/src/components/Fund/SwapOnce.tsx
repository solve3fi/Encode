"use client";

import { IconArrowRight } from "@tabler/icons-react";
import { useEffect, useMemo, useState } from "react";
import { INTENTS_DEFAULT_SLIPPAGE_BPS } from "@/configs/intents";
import { fromBaseUnits } from "@/lib/intents/amount";
import {
	destinationTokens,
	isPopularSource,
	secondsUntil,
	sourceTokens,
} from "@/lib/intents/aurora";
import { INTENTS_CHAINS, resolveChain } from "@/lib/intents/chains";
import classes from "./Fund.module.css";
import { ChainChips, CopyButton, short } from "./shared";
import {
	api,
	type FundQuote,
	type FundSession,
	type FundToken,
	loadSession,
	saveSession,
	useDryQuote,
	useSwapProgress,
} from "./useFund";

const SLIPPAGES = [50, 100, 300];
const SOURCE_CHAINS = INTENTS_CHAINS.filter((c) => c.slug !== "sol");

type Prefill = { chain?: string; asset?: string; amount?: string; to?: string };

/** One-time cross-chain swap: price it, get a one-time deposit address, send from your other wallet, watch it arrive. */
export const SwapOnce: React.FC<{
	tokens: FundToken[];
	prefill: Prefill;
	/** The connected Solana wallet (funds are delivered here). */
	wallet?: string;
}> = ({ tokens, prefill, wallet }) => {
	const [chain, setChain] = useState(
		resolveChain(prefill.chain ?? "")?.slug ?? "base",
	);
	const sources = useMemo(() => sourceTokens(tokens, chain), [tokens, chain]);
	const destinations = useMemo(() => destinationTokens(tokens), [tokens]);
	const [originId, setOriginId] = useState<string>("");
	const [destId, setDestId] = useState<string>("");
	const [amount, setAmount] = useState(prefill.amount ?? "");
	const [refundTo, setRefundTo] = useState("");
	const [slippage, setSlippage] = useState(INTENTS_DEFAULT_SLIPPAGE_BPS);
	const [session, setSession] = useState<FundSession | null>(null);
	const [creating, setCreating] = useState(false);
	const [createError, setCreateError] = useState<string | null>(null);

	const origin = sources.find((t) => t.assetId === originId) ?? sources[0];
	const destination =
		destinations.find((t) => t.assetId === destId) ??
		destinations.find((t) => t.symbol === (prefill.to ?? "").toUpperCase()) ??
		destinations[0];
	const chainInfo = resolveChain(chain);

	useEffect(() => {
		const wanted = sources.find(
			(t) => t.symbol.toLowerCase() === (prefill.asset ?? "").toLowerCase(),
		);
		setOriginId((current) =>
			sources.some((t) => t.assetId === current)
				? current
				: ((wanted ?? sources[0])?.assetId ?? ""),
		);
	}, [sources, prefill.asset]);

	// Resume an unfinished swap after a refresh: the deposit address must never be lost.
	useEffect(() => {
		setSession(wallet ? loadSession(wallet) : null);
	}, [wallet]);

	const dry = useDryQuote({
		originAsset: origin?.assetId,
		destinationAsset: destination?.assetId,
		amountText: amount,
		originDecimals: origin?.decimals,
		recipient: wallet,
		refundTo,
		slippageBps: slippage,
	});

	const costPct = useMemo(() => {
		const inUsd = Number(dry.quote?.amountInUsd);
		const outUsd = Number(dry.quote?.amountOutUsd);
		return inUsd > 0 && outUsd > 0
			? Math.max(0, ((inUsd - outUsd) / inUsd) * 100)
			: null;
	}, [dry.quote]);

	async function reserve() {
		if (!wallet || !origin || !destination || !dry.units) return;
		setCreating(true);
		setCreateError(null);
		try {
			const result = await api<{ quote: FundQuote }>("/api/intents/quote", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					originAsset: origin.assetId,
					destinationAsset: destination.assetId,
					amount: dry.units,
					recipient: wallet,
					refundTo: refundTo.trim(),
					slippageBps: slippage,
					dry: false,
				}),
			});
			const q = result.quote;
			if (!q.depositAddress)
				throw new Error("No deposit address was returned. Try again.");
			const next: FundSession = {
				depositAddress: q.depositAddress,
				depositMemo: q.depositMemo,
				deadline: q.deadline,
				originSymbol: origin.symbol,
				originChain: origin.blockchain,
				network: chainInfo?.network ?? origin.blockchain,
				amountIn: fromBaseUnits(q.amountIn, origin.decimals, 8),
				destSymbol: destination.symbol,
				amountOut: fromBaseUnits(q.amountOut, destination.decimals, 6),
				refundTo: refundTo.trim(),
				createdAt: Date.now(),
			};
			saveSession(wallet, next);
			setSession(next);
		} catch (e) {
			setCreateError(
				e instanceof Error ? e.message : "Could not get a deposit address.",
			);
		} finally {
			setCreating(false);
		}
	}

	if (session && wallet) {
		return (
			<Deposit
				session={session}
				onDone={() => {
					saveSession(wallet, null);
					setSession(null);
					setAmount("");
				}}
			/>
		);
	}

	const canReserve = Boolean(dry.quote) && !dry.loading && !creating;
	return (
		<div className={classes.card}>
			<h2 className={classes.h2}>Swap from another chain</h2>
			<p className={classes.lede}>
				Pick what you hold. Solve3 shows the price, then gives you a one-time
				address to send it to.
			</p>

			<span className={classes.label}>From chain</span>
			<ChainChips
				chains={SOURCE_CHAINS}
				value={chain}
				onChange={setChain}
				label="Source chain"
			/>

			<div className={classes.row}>
				<label className={classes.field}>
					<span className={classes.label}>You send</span>
					<input
						className={classes.input}
						inputMode="decimal"
						placeholder="0.0"
						value={amount}
						onChange={(e) =>
							setAmount(e.currentTarget.value.replace(/[^0-9.]/g, ""))
						}
						aria-label="Amount to send"
					/>
				</label>
				<label className={classes.field}>
					<span className={classes.label}>Asset</span>
					<select
						className={classes.input}
						value={origin?.assetId ?? ""}
						onChange={(e) => setOriginId(e.currentTarget.value)}
						aria-label="Asset to send"
					>
						<optgroup label="Popular">
							{sources.filter(isPopularSource).map((t) => (
								<option key={t.assetId} value={t.assetId}>
									{t.symbol}
								</option>
							))}
						</optgroup>
						{sources.some((t) => !isPopularSource(t)) && (
							<optgroup label="All assets">
								{sources
									.filter((t) => !isPopularSource(t))
									.map((t) => (
										<option key={t.assetId} value={t.assetId}>
											{t.symbol}
										</option>
									))}
							</optgroup>
						)}
					</select>
				</label>
			</div>

			<span className={classes.label}>You receive on Solana</span>
			<div
				className={classes.chips}
				role="radiogroup"
				aria-label="Receive asset"
			>
				{destinations.map((t) => (
					// biome-ignore lint/a11y/useSemanticElements: styled chip group
					<button
						key={t.assetId}
						type="button"
						role="radio"
						aria-checked={destination?.assetId === t.assetId}
						className={classes.chip}
						onClick={() => setDestId(t.assetId)}
					>
						{t.symbol}
					</button>
				))}
			</div>

			<label className={classes.field}>
				<span className={classes.label}>
					Your {chainInfo?.label ?? "source"} address for refunds
				</span>
				<input
					className={classes.input}
					placeholder={
						chain === "btc" ? "bc1…" : chain === "near" ? "name.near" : "0x…"
					}
					value={refundTo}
					onChange={(e) => setRefundTo(e.currentTarget.value)}
					aria-label="Refund address"
					autoComplete="off"
					spellCheck={false}
				/>
				<span className={classes.help}>
					If the swap cannot finish, your funds go back here. Use an address you
					control.
				</span>
			</label>

			<div className={classes.chips} role="radiogroup" aria-label="Slippage">
				<span className={classes.label} style={{ marginRight: 8 }}>
					Max slippage
				</span>
				{SLIPPAGES.map((bps) => (
					// biome-ignore lint/a11y/useSemanticElements: styled chip group
					<button
						key={bps}
						type="button"
						role="radio"
						aria-checked={slippage === bps}
						className={classes.chip}
						onClick={() => setSlippage(bps)}
					>
						{bps / 100}%
					</button>
				))}
			</div>

			<div className={classes.quote} aria-live="polite">
				{!wallet && (
					<span className={classes.muted}>
						Connect your Solana wallet to get a quote.
					</span>
				)}
				{wallet && !dry.ready && (
					<span className={classes.muted}>
						Enter an amount and your refund address to see the price.
					</span>
				)}
				{dry.ready && dry.loading && (
					<span className={classes.muted}>Getting the price…</span>
				)}
				{dry.error && <span className={classes.error}>{dry.error}</span>}
				{dry.quote && origin && destination && (
					<>
						<div className={classes.big}>
							≈ {fromBaseUnits(dry.quote.amountOut, destination.decimals, 6)}{" "}
							{destination.symbol}
						</div>
						<ul className={classes.facts}>
							<li>
								You send {amount} {origin.symbol} on {chainInfo?.network}
							</li>
							{dry.quote.minAmountOut && (
								<li>
									You get at least{" "}
									{fromBaseUnits(
										dry.quote.minAmountOut,
										destination.decimals,
										6,
									)}{" "}
									{destination.symbol}
								</li>
							)}
							{costPct !== null && (
								<li>
									Total cost about {costPct.toFixed(2)}% (fees and spread)
								</li>
							)}
							{dry.quote.timeEstimate !== undefined && (
								<li>
									Usually about{" "}
									{Math.max(1, Math.round(dry.quote.timeEstimate / 60))} min
								</li>
							)}
						</ul>
					</>
				)}
			</div>

			{createError && <p className={classes.error}>{createError}</p>}
			<button
				type="button"
				className={classes.primary}
				disabled={!canReserve}
				onClick={() => void reserve()}
			>
				{creating ? "Getting your address…" : "Get deposit address"}
				<IconArrowRight size={17} stroke={1.8} aria-hidden="true" />
			</button>
			<p className={classes.fine}>
				Nothing is sent from this page. You send from your own wallet, and
				Solve3 never holds your funds.
			</p>
		</div>
	);
};

const Deposit: React.FC<{ session: FundSession; onDone: () => void }> = ({
	session,
	onDone,
}) => {
	const { progress, error, refresh } = useSwapProgress(session);
	const [tx, setTx] = useState("");
	const [submitMsg, setSubmitMsg] = useState<string | null>(null);
	const [now, setNow] = useState(Date.now());
	useEffect(() => {
		const t = window.setInterval(() => setNow(Date.now()), 1000);
		return () => window.clearInterval(t);
	}, []);
	const left = secondsUntil(session.deadline, now);
	const view = progress?.view;
	const done = view?.final === true;

	async function submit() {
		setSubmitMsg(null);
		try {
			await api("/api/intents/submit", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					txHash: tx.trim(),
					depositAddress: session.depositAddress,
					memo: session.depositMemo,
				}),
			});
			setSubmitMsg("Thanks. Aurora will check it now.");
			void refresh();
		} catch (e) {
			setSubmitMsg(e instanceof Error ? e.message : "Could not send that.");
		}
	}

	return (
		<div className={classes.card}>
			<h2 className={classes.h2}>
				Send {session.amountIn} {session.originSymbol}
			</h2>
			<p className={classes.lede}>
				to receive about {session.amountOut} {session.destSymbol} on Solana.
			</p>

			{!done && (
				<>
					<div className={classes.address}>
						<span className={classes.label}>
							Deposit address ({session.network} network)
						</span>
						<code className={classes.code}>{session.depositAddress}</code>
						<CopyButton
							value={session.depositAddress}
							label="Copy deposit address"
						/>
					</div>
					{session.depositMemo && (
						<div className={classes.address}>
							<span className={classes.label}>Memo (required)</span>
							<code className={classes.code}>{session.depositMemo}</code>
							<CopyButton value={session.depositMemo} label="Copy memo" />
						</div>
					)}
					<ul className={classes.rules}>
						<li>
							Send only <strong>{session.originSymbol}</strong> on the{" "}
							<strong>{session.network}</strong> network to this address.
							Anything else may be lost.
						</li>
						<li>
							Send exactly{" "}
							<strong>
								{session.amountIn} {session.originSymbol}
							</strong>
							. A smaller amount is refunded when the quote expires.
						</li>
						<li>
							This address is for this swap only. If it expires, start again; do
							not reuse it.
						</li>
						{left !== null && (
							<li>
								{left > 0
									? `Quote expires in ${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}.`
									: "The quote has expired. Do not send. Start again."}
							</li>
						)}
					</ul>
				</>
			)}

			<ol className={classes.rail} aria-label="Progress">
				{["Waiting", "Deposit seen", "Swapping", "Arrived"].map(
					(label, index) => (
						<li
							key={label}
							data-state={
								(view?.step ?? 1) > index + 1
									? "done"
									: (view?.step ?? 1) === index + 1
										? view?.phase === "attention"
											? "warn"
											: view?.phase === "done"
												? "done"
												: "now"
										: "todo"
							}
						>
							{label}
						</li>
					),
				)}
			</ol>
			<div
				className={classes.status}
				data-phase={view?.phase ?? "waiting"}
				aria-live="polite"
			>
				<strong>{view?.title ?? "Checking status"}</strong>
				<span>{view?.detail ?? "One moment."}</span>
				{progress?.details.destinationTx && (
					<a
						href={
							progress.details.destinationTx.explorerUrl ??
							`https://solscan.io/tx/${progress.details.destinationTx.hash}`
						}
						target="_blank"
						rel="noopener noreferrer"
					>
						View the Solana transaction{" "}
						{short(progress.details.destinationTx.hash)}
					</a>
				)}
				{progress?.details.refunded && (
					<span>
						Refunded: {progress.details.refunded} {session.originSymbol} to{" "}
						{short(session.refundTo, 10, 6)}
					</span>
				)}
				{error && <span className={classes.error}>{error}</span>}
			</div>

			{!done && (
				<details className={classes.details}>
					<summary>I already sent it</summary>
					<p className={classes.help}>
						Optional: paste your transaction hash so Aurora can pick it up
						sooner.
					</p>
					<div className={classes.row}>
						<input
							className={classes.input}
							placeholder="Transaction hash"
							value={tx}
							onChange={(e) => setTx(e.currentTarget.value)}
							aria-label="Transaction hash"
						/>
						<button
							type="button"
							className={classes.ghost}
							disabled={tx.trim().length < 10}
							onClick={() => void submit()}
						>
							Send
						</button>
					</div>
					{submitMsg && <p className={classes.help}>{submitMsg}</p>}
				</details>
			)}

			<button
				type="button"
				className={done ? classes.primary : classes.ghost}
				onClick={onDone}
			>
				{done ? "Fund again" : "Cancel and start over"}
			</button>
			{!done && (
				<p className={classes.fine}>
					Cancelling only clears this page. If you already sent funds, they are
					still processed or refunded to {short(session.refundTo, 10, 6)}.
				</p>
			)}
		</div>
	);
};
