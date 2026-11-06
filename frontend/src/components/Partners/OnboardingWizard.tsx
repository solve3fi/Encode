"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import Link from "next/link";
import { useMemo, useState } from "react";
import { useAllTokens } from "@/hooks/useToken";
import { ModalType } from "@/stores/modal";
import { useModalActions } from "@/stores/modal/ModalProvider";
import classes from "./Onboarding.module.css";

type Path = "" | "wl" | "new";
type StepId = "verify" | "project" | "listing" | "pool" | "liq" | "rewards" | "vote" | "review";

const META: Record<StepId, [string, string, string]> = {
	verify: ["Verify", "Verify your whitelist spot", "Paste your mint and we check it against the list. No forms to fill in."],
	project: ["Project", "Tell us about your project", "We use this to set up your listing, pool and gauge."],
	listing: ["Request listing", "Request your listing", "Solve3 is whitelisted. We review each request before a token can list."],
	pool: ["Pool", "Pick your first pool", "Choose what your token trades against and how much each swap costs."],
	liq: ["Liquidity", "Seed your liquidity", "Choose a price range and deposit. You can seed liquidity before your listing is approved."],
	rewards: ["Rewards", "Fund rewards for voters", "Rewards give veSOLV3 holders a reason to vote for your pool."],
	vote: ["Vote", "Lock SOLV3 and get votes", "Vote for your own gauge, and ask the Accelerator to match your votes."],
	review: ["Review", "Review your launch plan", "Check your plan, then confirm each step with your wallet."],
};

const IDS: Record<"wl" | "new", StepId[]> = {
	wl: ["verify", "pool", "liq", "rewards", "vote", "review"],
	new: ["project", "listing", "pool", "liq", "rewards", "vote", "review"],
};

const QUOTES = [
	["SOL", "The most common quote token."],
	["USDC", "Priced in dollars."],
	["SOLV3", "Pairs your token with the protocol token."],
] as const;

const FEES = [
	["0.3%", 3000, "Best for exotic pairs.", false],
	["1%", 10000, "Best for most pairs.", true],
	["2%", 20000, "Best for exotic pairs.", false],
] as const;

const PRESETS = [
	["full", "Full range", "Volatile assets such as new tokens.", true],
	["wide", "Wide", "Tokens with notable price movement.", false],
	["balanced", "Balanced", "Stable and moderately volatile tokens.", false],
	["narrow", "Narrow", "Blue-chip tokens with little movement.", false],
] as const;

const EPOCHS = [4, 8, 12];

type Whitelist =
	| { state: "idle" }
	| { state: "checking" }
	| { state: "found"; symbol: string; name: string; owner: boolean }
	| { state: "pending" | "none" | "rejected" }
	| { state: "error"; message: string };

const num = (value: string) => {
	const n = Number.parseFloat(value.replace(/,/g, ""));
	return Number.isFinite(n) && n > 0 ? n : 0;
};
const fmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });

export const OnboardingWizard: React.FC = () => {
	const { publicKey } = useWallet();
	const { setOpenModal } = useModalActions();
	const tokens = useAllTokens();

	const [path, setPath] = useState<Path>("");
	const [step, setStep] = useState(0);
	const [mint, setMint] = useState("");
	const [name, setName] = useState("");
	const [symbol, setSymbol] = useState("");
	const [contact, setContact] = useState("");
	const [web, setWeb] = useState("");
	const [social, setSocial] = useState("");
	const [why, setWhy] = useState("");
	const [quote, setQuote] = useState("SOL");
	const [fee, setFee] = useState(1);
	const [preset, setPreset] = useState("full");
	const [amountA, setAmountA] = useState("");
	const [amountB, setAmountB] = useState("");
	const [budget, setBudget] = useState("1000");
	const [epochs, setEpochs] = useState(4);
	const [lock, setLock] = useState("");
	const [accel, setAccel] = useState(true);
	const [whitelist, setWhitelist] = useState<Whitelist>({ state: "idle" });
	const [accelStatus, setAccelStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");

	const sym = (symbol || (whitelist.state === "found" ? whitelist.symbol : "") || "TOKEN").toUpperCase();
	const ids = path ? IDS[path] : [];
	const current = ids[Math.min(step, ids.length - 1)];
	const budgetN = num(budget);
	const lockN = num(lock);
	const feeTier = FEES[fee];

	const quoteMint = useMemo(() => {
		const list = Object.values(tokens);
		const bySymbol = (match: (s: string) => boolean) => list.find((token) => match(token.symbol.toUpperCase()));
		const found =
			quote === "SOL"
				? bySymbol((s) => s === "SOL")
				: quote === "USDC"
					? bySymbol((s) => s.endsWith("USDC"))
					: bySymbol((s) => s === "SOLV3");
		return found?.address ?? "";
	}, [tokens, quote]);

	const mintValid = useMemo(() => {
		try {
			new PublicKey(mint.trim());
			return true;
		} catch {
			return false;
		}
	}, [mint]);

	const poolHref = `/liquidity/create?${new URLSearchParams({
		...(mintValid ? { currencyA: mint.trim() } : {}),
		...(quoteMint && quoteMint !== mint.trim() ? { currencyB: quoteMint } : {}),
		pool: "manual",
		fee: String(feeTier[1]),
	}).toString()}`;
	const listingHref = `/liquidity/request-token?${new URLSearchParams({
		...(mintValid ? { mint: mint.trim() } : {}),
		...(symbol ? { symbol: symbol.toUpperCase() } : {}),
		...(name ? { name } : {}),
		...(web ? { website: web } : {}),
		...(social ? { twitter: social } : {}),
	}).toString()}`;

	const verify = async () => {
		setWhitelist({ state: "checking" });
		try {
			const params = new URLSearchParams({ mint: mint.trim(), ...(publicKey ? { wallet: publicKey.toBase58() } : {}) });
			const res = await fetch(`/api/partners/whitelist?${params}`);
			const data = await res.json();
			if (!res.ok) throw new Error(data.error ?? "Check failed");
			if (data.status === "approved") {
				setWhitelist({ state: "found", symbol: data.symbol, name: data.name, owner: Boolean(data.owner) });
				setSymbol(data.symbol);
				setName(data.name);
			} else setWhitelist({ state: data.status });
		} catch (error) {
			setWhitelist({ state: "error", message: error instanceof Error ? error.message : "Check failed" });
		}
	};

	const applyAccelerator = async () => {
		setAccelStatus("sending");
		try {
			const res = await fetch("/api/partner-applications", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					project: name || sym,
					pair: `${sym} / ${quote}`,
					mint: mint.trim(),
					contact: contact || publicKey?.toBase58() || "",
					accelerator: "yes",
				}),
			});
			if (!res.ok) throw new Error();
			setAccelStatus("sent");
		} catch {
			setAccelStatus("error");
		}
	};

	const walletRow = (hint: string) => (
		<div className={classes.walletRow}>
			<div>
				<strong>{publicKey ? "Wallet connected" : "Connect your wallet"}</strong>
				<span>{hint}</span>
			</div>
			<button
				type="button"
				className={publicKey ? classes.connected : classes.primary}
				onClick={() => !publicKey && setOpenModal(ModalType.WALLET)}
			>
				{publicKey ? `${publicKey.toBase58().slice(0, 4)}…${publicKey.toBase58().slice(-4)}` : "Connect wallet"}
			</button>
		</div>
	);

	const choose = (next: Path) => {
		setPath(next);
		setStep(0);
	};

	if (!path) {
		return (
			<div className={classes.page}>
				<header className={classes.head}>
					<span className={classes.eyebrow}>Launch partners</span>
					<h1>Set up your <span className={classes.grad}>launch.</span></h1>
					<p>Pick the path that matches where your token is today. You can switch at any time.</p>
				</header>
				<div className={classes.gate}>
					<button type="button" className={classes.gateCard} onClick={() => choose("wl")}>
						<span className={classes.eyebrow}>Fastest</span>
						<strong>I&apos;m already whitelisted</strong>
						<span>Your token is already on the Solve3 list. Verify your mint and we skip the project details, then walk you through adding liquidity.</span>
						<small>Verify mint · Pool · Liquidity · Rewards · Vote · Review</small>
						<em>Continue as whitelisted →</em>
					</button>
					<button type="button" className={classes.gateCard} onClick={() => choose("new")}>
						<span className={classes.eyebrow}>New to Solve3</span>
						<strong>I need to get whitelisted</strong>
						<span>Tell us about your project and request a listing. You can plan your pool, liquidity, rewards and votes while the request is reviewed.</span>
						<small>Project · Request listing · Pool · Liquidity · Rewards · Vote · Review</small>
						<em>Start with your project →</em>
					</button>
				</div>
			</div>
		);
	}

	const [stepLabel, stepTitle, stepLead] = META[current];
	const last = ids.length - 1;
	const idx = ids.indexOf(current);

	return (
		<div className={classes.page}>
			<header className={classes.head}>
				<span className={classes.eyebrow}>Launch partners</span>
				<h1>Set up your <span className={classes.grad}>launch.</span></h1>
				<button type="button" className={classes.change} onClick={() => setPath("")}>
					{path === "wl" ? "Already whitelisted" : "Getting whitelisted"} · Change
				</button>
			</header>

			<div className={classes.layout}>
				<nav aria-label="Setup steps" className={classes.steps}>
					{ids.map((id, i) => (
						<button
							key={id}
							type="button"
							className={classes.stepBtn}
							aria-current={i === idx ? "step" : undefined}
							onClick={() => setStep(i)}
						>
							<span className={`${classes.dot} ${i < idx ? classes.done : i === idx ? classes.cur : ""}`}>
								{i < idx ? "✓" : i + 1}
							</span>
							<span>{META[id][0]}</span>
						</button>
					))}
				</nav>

				<section aria-label="Step" className={classes.panel}>
					<div className={classes.stepHead}>
						<span className={classes.eyebrow}>Step {idx + 1} of {ids.length}</span>
						<h2>{stepTitle}</h2>
						<p>{current === "review" && path === "new" ? "Request your listing to finish. You can add liquidity now; rewards and votes need an approved listing." : stepLead}</p>
					</div>

					{current === "verify" && (
						<div className={classes.body}>
							{walletRow("Use the wallet that is on your whitelist entry.")}
							<label>Token mint address
								<input value={mint} onChange={(e) => setMint(e.target.value)} placeholder="Paste your SPL token mint" />
							</label>
							<div>
								<button type="button" className={classes.primary} disabled={!mintValid || whitelist.state === "checking"} onClick={verify}>
									{whitelist.state === "checking" ? "Checking…" : "Check whitelist"}
								</button>
							</div>
							{whitelist.state === "found" && (
								<div className={classes.ok} role="status">
									<span className={classes.eyebrow}>Whitelisted</span>
									<strong>{whitelist.name} · {whitelist.symbol}</strong>
									<span>
										We found your listing, so there is nothing else to fill in. Next you choose a pool and add liquidity.
										{publicKey && !whitelist.owner && " The connected wallet did not submit this listing; use the whitelist wallet to manage it."}
									</span>
								</div>
							)}
							{whitelist.state === "pending" && <p className={classes.warn} role="status">This listing request is still pending review.</p>}
							{(whitelist.state === "none" || whitelist.state === "rejected") && (
								<p className={classes.warn} role="status">That mint is not on the whitelist.</p>
							)}
							{whitelist.state === "error" && <p className={classes.err} role="alert">{whitelist.message}</p>}
							<p className={classes.small}>
								Not on the list? <button type="button" className={classes.inline} onClick={() => choose("new")}>Request a listing instead</button>
							</p>
						</div>
					)}

					{current === "project" && (
						<div className={classes.body}>
							<div className={classes.two}>
								<label>Project name<input value={name} onChange={(e) => setName(e.target.value)} placeholder="Acme Finance" /></label>
								<label>Token symbol<input value={symbol} onChange={(e) => setSymbol(e.target.value)} placeholder="ACME" /></label>
							</div>
							<label>Token mint address<input value={mint} onChange={(e) => setMint(e.target.value)} placeholder="Paste your SPL token mint" /></label>
							<label>Contact (Telegram, X or email)<input value={contact} onChange={(e) => setContact(e.target.value)} placeholder="@handle or name@project.xyz" /></label>
							{walletRow("Use the wallet that will fund liquidity and rewards.")}
						</div>
					)}

					{current === "listing" && (
						<div className={classes.body}>
							<div className={classes.two}>
								<label>Website<input value={web} onChange={(e) => setWeb(e.target.value)} placeholder="https://project.xyz" /></label>
								<label>X or Telegram community<input value={social} onChange={(e) => setSocial(e.target.value)} placeholder="@project" /></label>
							</div>
							<label>Why list {sym} on Solve3?<input value={why} onChange={(e) => setWhy(e.target.value)} placeholder="One or two sentences" /></label>
							<div className={classes.review}>
								<span className={classes.eyebrow}>What we review</span>
								<ul>
									<li>Token mint, supply and authorities.</li>
									<li>An active community and a working product.</li>
									<li>Project legitimacy and a clear use for the token. We reply by email or Telegram.</li>
								</ul>
							</div>
							<div>
								<Link href={listingHref} className={classes.primary}>Request listing</Link>
							</div>
							<p className={classes.small}>
								Submitting a listing opens the signed request form with your details filled in. You can keep going while we review. You can create your pool and add liquidity now, before approval. Rewards and votes need an approved listing.
							</p>
						</div>
					)}

					{current === "pool" && (
						<div className={classes.body}>
							<h3>Pair {sym} with</h3>
							<div className={classes.cards}>
								{QUOTES.map(([q, desc]) => (
									<button key={q} type="button" className={classes.option} aria-pressed={quote === q} onClick={() => setQuote(q)}>
										<strong>{q}</strong><span>{desc}</span>
									</button>
								))}
							</div>
							<h3>Fee tier</h3>
							<div className={classes.cards}>
								{FEES.map(([rate, , desc, rec], i) => (
									<button key={rate} type="button" className={classes.option} aria-pressed={fee === i} onClick={() => setFee(i)}>
										<strong>{rate}{rec && <em className={classes.rec}>Recommended</em>}</strong><span>{desc}</span>
									</button>
								))}
							</div>
							<div className={classes.summaryLine}><span>Your pool</span><b>{sym} / {quote}</b><span>·</span><span>{feeTier[0]} fee tier</span></div>
						</div>
					)}

					{current === "liq" && (
						<div className={classes.body}>
							<h3>Price range</h3>
							<div className={classes.cards}>
								{PRESETS.map(([id, label, desc, rec]) => (
									<button key={id} type="button" className={classes.option} aria-pressed={preset === id} onClick={() => setPreset(id)}>
										<strong>{label}{rec && <em className={classes.rec}>Best for new</em>}</strong><span>{desc}</span>
									</button>
								))}
							</div>
							<h3>Deposit amounts</h3>
							<div className={classes.two}>
								<label>{sym}<input inputMode="decimal" value={amountA} onChange={(e) => setAmountA(e.target.value)} placeholder="0" /></label>
								<label>{quote}<input inputMode="decimal" value={amountB} onChange={(e) => setAmountB(e.target.value)} placeholder="0" /></label>
							</div>
							<p className={classes.small}>You can add more any time from Pools.</p>
							<div>
								<Link href={poolHref} className={classes.primary}>Create pool and add liquidity</Link>
							</div>
						</div>
					)}

					{current === "rewards" && (
						<div className={classes.body}>
							<label>Rewards per epoch
								<span className={classes.suffixed}>
									<input inputMode="numeric" value={budget} onChange={(e) => setBudget(e.target.value)} placeholder="0" />
									<b>{sym}</b>
								</span>
							</label>
							<h3>Duration</h3>
							<div className={classes.chips}>
								{EPOCHS.map((n) => (
									<button key={n} type="button" aria-pressed={epochs === n} onClick={() => setEpochs(n)}>
										{n} epochs{n === 4 ? " (30-day pilot)" : ""}
									</button>
								))}
							</div>
							<div className={classes.summaryLine}>
								<span>Total committed</span><b>{fmt(budgetN * epochs)} {sym}</b><span>·</span><span>Gauge {sym}/{quote}</span>
							</div>
							<p className={classes.small}>
								Voters on your gauge share these rewards and the pool&apos;s trading fees. Rewards are funded from your wallet when you confirm. Fund them on the <Link href="/bribes">Bribes page</Link> once your pool has a gauge.
							</p>
						</div>
					)}

					{current === "vote" && (
						<div className={classes.body}>
							<div className={classes.box}>
								<h3>Lock SOLV3 and vote for your gauge</h3>
								<p>Lock SOLV3 for veSOLV3 (1:1, permanent) and put 100% of your voting power on {sym}/{quote} each epoch.</p>
								<label>SOLV3 to lock
									<span className={classes.suffixed}>
										<input inputMode="numeric" value={lock} onChange={(e) => setLock(e.target.value)} placeholder="0" />
										<b>SOLV3</b>
									</span>
								</label>
								<p>You receive <b>{lockN ? fmt(lockN) : "0"} veSOLV3</b>. <Link href="/lock">Lock SOLV3</Link> · <Link href="/arena">Vote</Link></p>
							</div>
							<div className={classes.box}>
								<div className={classes.boxHead}>
									<h3>Apply for Accelerator vote matching</h3>
									<button type="button" className={classes.toggle} aria-pressed={accel} onClick={() => setAccel((v) => !v)}>
										{accel ? "Applying" : "Not applying"}
									</button>
								</div>
								<p>Selected projects add liquidity and receive vote matching from the Accelerator&apos;s veSOLV3.</p>
								<ul>
									<li>Matching starts after 1 epoch and runs for up to 4 epochs.</li>
									<li>If your pool earns 2% of votes, you can receive up to an extra 2% (10% maximum).</li>
									<li>Rewards earned by matched votes are recycled into your bribe pool for the next epoch.</li>
									<li>Projects are selected, and must stay in good standing throughout.</li>
								</ul>
							</div>
						</div>
					)}

					{current === "review" && (
						<div className={classes.body}>
							<dl className={classes.summary}>
								{path === "wl" ? (
									<div><dt>Whitelist</dt><dd>{whitelist.state === "found" ? `${whitelist.name} · verified` : "Not verified yet"}</dd></div>
								) : (
									<>
										<div><dt>Project</dt><dd>{name || "—"} · {sym}</dd></div>
										<div><dt>Listing</dt><dd>Request from the listing step</dd></div>
									</>
								)}
								<div><dt>Pool</dt><dd>{sym} / {quote} · {feeTier[0]} fee</dd></div>
								<div><dt>Liquidity</dt><dd>{PRESETS.find((p) => p[0] === preset)?.[1]} range{amountA || amountB ? ` · ${amountA || 0} ${sym} + ${amountB || 0} ${quote}` : ""}</dd></div>
								<div><dt>Rewards</dt><dd>{fmt(budgetN)} {sym} × {epochs} epochs</dd></div>
								<div><dt>Your votes</dt><dd>{lockN ? fmt(lockN) : "0"} veSOLV3 on {sym}/{quote}</dd></div>
								<div><dt>Accelerator</dt><dd>{accel ? "Applying for vote matching" : "Not applying"}</dd></div>
							</dl>
							<div className={classes.timeline}>
								<div><span className={classes.eyebrow}>Today</span><strong>Liquidity goes in</strong></div>
								<div><span className={classes.eyebrow}>First voted epoch</span><strong>Rewards fund, votes open</strong></div>
								<div><span className={classes.eyebrow}>Day 30</span><strong>Readout: scale or stop</strong></div>
							</div>
							<div className={classes.finish}>
								<Link href={poolHref} className={classes.primary}>Create pool &amp; add liquidity</Link>
								{path === "new" && <Link href={listingHref} className={classes.ghost}>Request listing</Link>}
								{accel && (
									<button type="button" className={classes.ghost} disabled={accelStatus === "sending" || accelStatus === "sent"} onClick={applyAccelerator}>
										{accelStatus === "sent" ? "Accelerator application sent" : accelStatus === "sending" ? "Sending…" : "Apply for Accelerator matching"}
									</button>
								)}
							</div>
							{accelStatus === "error" && <p className={classes.err} role="alert">Could not send the application. Try again or email admin@solve3.fi.</p>}
						</div>
					)}

					<div className={classes.nav}>
						<button type="button" className={classes.ghost} onClick={() => (idx === 0 ? setPath("") : setStep(idx - 1))}>Back</button>
						{idx < last && (
							<button type="button" className={classes.primary} onClick={() => setStep(idx + 1)}>
								Continue
							</button>
						)}
					</div>
				</section>
			</div>
		</div>
	);
};
