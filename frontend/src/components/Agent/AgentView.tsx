"use client";

import { useLingui } from "@lingui/react";
import { Button, Checkbox, NumberInput } from "@mantine/core";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { Transaction } from "@solana/web3.js";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useEffect, useState } from "react";
import { assertFresh, ChainFailure, ExpiredBeforeSigning, NeverLanded, sendAndConfirmRobust } from "@/lib/agentSend";
import { notification } from "../Notifications";
import styles from "./Agent.module.css";

type AgentLock = { id: number; amount: string; votingPower: string; lastVoteEpoch: number };
type Claimable = {
	summary: { claimCount: number; estimatedUsd: number; unpricedMints: string[] };
	rows: { lockId: number; epoch: number; gauge: string; autoVoteFeeBps: number }[];
};
type Pool = { gauge: string; pool: string; label: string; votesNow: string; sharePercent: number; bribes: number };
type Gauges = {
	epoch: { number: number; endTime: number; votingOpen: boolean; secondsUntilCutoff: number };
	gauges: Pool[];
};
type VotePlan = {
	epoch: number;
	votingOpen: boolean;
	lockId: number;
	allocations: { gauge: string; pool: string; percent: number; expectedValue: number }[];
	valuedIn?: "usd" | "SOLV3";
	warnings: string[];
};
type AutoInfo = { available: boolean; voter?: string; feeBps?: number; reason?: string };
type AutoStatus = { locks: { lockId: number; enrolled: boolean; voter: string | null; usingAgent: boolean }[] };
type TxBundle = { transactions: { transaction: string; description: string; lastValidBlockHeight?: number }[] };

const COLORS = ["#685df7", "#58d7ff", "#f5b14c", "#5fe3a1", "#ff7ab8", "#b3adff", "#ffd36b", "#7ee0ff"];

// Sample data for ?demo=1: lets anyone preview the connected screens without a wallet. Nothing here can send a transaction.
const DEMO_GAUGES: Gauges = {
	epoch: { number: 3, endTime: 0, votingOpen: true, secondsUntilCutoff: 4 * 86400 + 21 * 3600 },
	gauges: [
		{ gauge: "g1", pool: "p1", label: "SOLV3 / devUSDC", votesNow: "0", sharePercent: 0.4, bribes: 0 },
		{ gauge: "g2", pool: "p2", label: "SOL / devUSDC", votesNow: "0", sharePercent: 98.7, bribes: 0 },
		{ gauge: "g3", pool: "p3", label: "6Ryd…ka1f / devUSDC", votesNow: "0", sharePercent: 0, bribes: 0 },
		{ gauge: "g4", pool: "p4", label: "9ueY…1SJq / devUSDC", votesNow: "0", sharePercent: 0.9, bribes: 0 },
	],
};
const DEMO_LOCKS: AgentLock[] = [
	{ id: 6, amount: "1500000000000", votingPower: "1500000000000", lastVoteEpoch: 3 },
	{ id: 8, amount: "835976008865", votingPower: "835976008865", lastVoteEpoch: 2 },
];
const DEMO_CLAIM: Claimable = { summary: { claimCount: 3, estimatedUsd: 0, unpricedMints: [] }, rows: [] };
const DEMO_AUTO: AutoStatus = {
	locks: [
		{ lockId: 6, enrolled: true, voter: "demo", usingAgent: true },
		{ lockId: 8, enrolled: false, voter: null, usingAgent: false },
	],
};

const solv3 = (raw: string | number) =>
	(Number(raw) / 1e9).toLocaleString(undefined, { maximumFractionDigits: 2 });

function duration(seconds: number): string {
	if (seconds <= 0) return "now";
	const d = Math.floor(seconds / 86400);
	const h = Math.floor((seconds % 86400) / 3600);
	const m = Math.floor((seconds % 3600) / 60);
	return d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${m}m`;
}

async function agent<T>(path: string, body?: unknown): Promise<T> {
	const res = await fetch(`/api/agent/${path}`, {
		method: body ? "POST" : "GET",
		headers: body ? { "content-type": "application/json" } : undefined,
		body: body ? JSON.stringify(body) : undefined,
	});
	const json = await res.json().catch(() => ({}));
	if (!res.ok) throw new Error(json.error ?? `Agent error ${res.status}`);
	return json as T;
}

/** Technical agent warnings, translated for people. Unknown warnings are dropped rather than shown raw. */
function friendly(warnings: string[]): string[] {
	const out = new Set<string>();
	for (const w of warnings) {
		if (/PRICES_JSON|no price configured|only SOLV3 emissions/i.test(w))
			out.add("Devnet test tokens have no price, so the estimate only counts SOLV3 rewards.");
		else if (/voting is closed/i.test(w)) out.add("Voting is closed until next week.");
	}
	return [...out];
}

export const AgentView: React.FC = () => {
	const { i18n } = useLingui();
	const queryClient = useQueryClient();
	const { connection } = useConnection();
	const { publicKey, sendTransaction, signTransaction } = useWallet();
	const [demo, setDemo] = useState(false);
	useEffect(() => {
		try {
			setDemo(new URLSearchParams(window.location.search).has("demo"));
		} catch {
			/* no window: stay off */
		}
	}, []);
	const owner = demo ? "demo" : publicKey?.toBase58();
	const live = !demo;

	const gauges = useQuery({ queryKey: ["agent-gauges"], queryFn: () => agent<Gauges>("v1/gauges"), refetchInterval: 60_000, enabled: live });
	const locks = useQuery({
		queryKey: ["agent-locks", owner],
		queryFn: async () => (await agent<{ locks: AgentLock[] }>(`v1/locks/${owner}`)).locks,
		enabled: live && !!owner,
	});
	const claimable = useQuery({
		queryKey: ["agent-claimable", owner],
		queryFn: () => agent<Claimable>(`v1/claimable/${owner}`),
		enabled: live && !!owner,
	});
	const autoInfo = useQuery({ queryKey: ["agent-autovote"], queryFn: () => agent<AutoInfo>("v1/autovote"), enabled: live });
	const autoStatus = useQuery({
		queryKey: ["agent-autovote-status", owner],
		queryFn: () => agent<AutoStatus>(`v1/autovote/status/${owner}`),
		enabled: live && !!owner && !!autoInfo.data?.available,
	});
	const plans = useQuery({
		queryKey: ["agent-plans", owner, locks.data?.map((l) => l.id).join(",")],
		queryFn: () => Promise.all((locks.data ?? []).map((l) => agent<VotePlan>(`v1/vote-plan/${owner}/${l.id}`))),
		enabled: live && !!owner && !!locks.data?.length,
	});

	const gaugesData = demo ? DEMO_GAUGES : gauges.data;
	const locksData = demo ? DEMO_LOCKS : locks.data;
	const claimData = demo ? DEMO_CLAIM : claimable.data;
	const autoInfoData: AutoInfo | undefined = demo ? { available: true, feeBps: 1500 } : autoInfo.data;
	const autoStatusData = demo ? DEMO_AUTO : autoStatus.data;
	const plansData = demo ? [] : plans.data;

	// The agent builds each transaction; the wallet reviews and signs it. The agent never holds keys.
	const run = useMutation({
		mutationFn: async ({ path, body }: { path: string; body: unknown }) => {
			if (demo) throw new Error(i18n._("This is sample data. Connect a wallet to use the agent."));
			if (!publicKey) throw new Error(i18n._("Connect a wallet first"));
			const bundle = await agent<TxBundle>(path, body);
			for (const t of bundle.transactions) {
				const tx = Transaction.from(Buffer.from(t.transaction, "base64"));
				// Transactions expire after about a minute. If the approval took too long, say so instead of failing oddly.
				const lastValid = t.lastValidBlockHeight || (await connection.getBlockHeight("confirmed")) + 120;
				await assertFresh(connection, t.lastValidBlockHeight ?? 0);
				if (signTransaction) {
					// Sign, then send ourselves and keep rebroadcasting until it lands or expires (busy clusters drop transactions).
					const signed = await signTransaction(tx);
					await sendAndConfirmRobust(connection, signed.serialize(), lastValid);
				} else {
					const signature = await sendTransaction(tx, connection);
					await connection.confirmTransaction(
						{ signature, blockhash: tx.recentBlockhash ?? "", lastValidBlockHeight: lastValid },
						"confirmed",
					);
				}
			}
			return bundle.transactions.length;
		},
		onSuccess: async () => {
			notification.success({ title: i18n._("Agent"), message: i18n._("Done. Your wallet confirmed it.") });
			for (const key of ["agent-claimable", "agent-plans", "agent-locks", "agent-gauges", "agent-autovote-status", "vesolve-vote-rewards"])
				await queryClient.invalidateQueries({ queryKey: [key] });
		},
		onError: (error: Error) => {
			const message =
				error instanceof NeverLanded || error instanceof ExpiredBeforeSigning
					? error.message
					: error instanceof ChainFailure
						? i18n._("The transaction was rejected on-chain, so nothing changed (only the small network fee was spent). Refresh and try again.")
						: /blockhash not found|expired/i.test(error.message)
							? new ExpiredBeforeSigning().message
							: error.message;
			notification.error({ title: i18n._("Agent"), message });
		},
	});
	const busy = run.isPending;
	const onRun = (path: string, body: Record<string, unknown>) => run.mutate({ path, body: { owner, ...body } });

	const epoch = gaugesData?.epoch;
	const hasLocks = !!locksData?.length;
	const allVoted = hasLocks && !!epoch && (locksData ?? []).every((l) => l.lastVoteEpoch === epoch.number);
	const totalLocked = (locksData ?? []).reduce((t, l) => t + Number(l.amount), 0);
	const claimCount = claimData?.summary.claimCount ?? 0;

	const steps: { title: string; done: boolean; body: React.ReactNode }[] = [
		{
			title: i18n._("Connect your wallet"),
			done: !!owner,
			body: i18n._("Use a Solana wallet set to Devnet. Everything here uses test tokens with no real value."),
		},
		{
			title: i18n._("Lock SOLV3"),
			done: hasLocks,
			body: (
				<>
					{i18n._("Get test SOL from the")}{" "}
					<a href="https://faucet.solana.com" target="_blank" rel="noreferrer">{i18n._("faucet")}</a>
					{", "}{i18n._("swap for SOLV3 on")} <Link href="/swap">Swap</Link>
					{". "}{i18n._("Locks are permanent and give you voting power.")}
				</>
			),
		},
		{
			title: i18n._("Vote every week"),
			done: allVoted,
			body: i18n._("Choose which pools get this week's rewards. Voting closes 5 minutes before the week ends."),
		},
		{
			title: i18n._("Claim your rewards"),
			done: false,
			body: epoch
				? i18n._("Rewards unlock when the week ends (in {time}). Then press Claim all.", {
						time: duration(Math.max(0, epoch.secondsUntilCutoff + 300)),
					})
				: i18n._("Rewards unlock when each week ends. Then press Claim all."),
		},
	];

	return (
		<div className={styles.wrap}>
			<div className={styles.aurora} aria-hidden="true">
				<i />
				<i />
			</div>

			<section className={styles.hero}>
				<p className={styles.eyebrow}>
					<span className={styles.ping} />
					{i18n._("Solve3 Agent · Devnet beta")}
				</p>
				<h1 className={styles.title}>
					{i18n._("Your weekly voting")} <span className={styles.grad}>{i18n._("co-pilot")}</span>
				</h1>
				<p className={styles.lede}>
					{i18n._("It finds what you can claim, helps you vote, and can vote for you. You review and sign every transaction in your own wallet. It never holds your keys.")}
				</p>
				<div className={styles.heroLinks}>
					<Link href="/beta/agent/intro">{i18n._("How it works →")}</Link>
					{!demo && <Link href="/beta/agent?demo=1">{i18n._("Preview with sample data")}</Link>}
				</div>
			</section>

			{demo && (
				<div className={styles.demoBanner}>
					{i18n._("Sample data. Nothing here is real and buttons won't send anything. Connect a wallet and leave off ?demo=1 to use the agent.")}
				</div>
			)}

			<section className={styles.stats}>
				<div className={styles.stat}>
					<small>{i18n._("Week (epoch)")}</small>
					<strong>{epoch ? `#${epoch.number}` : "…"}</strong>
				</div>
				<div className={styles.stat}>
					<small>{i18n._("Voting closes in")}</small>
					<strong className={epoch?.votingOpen ? styles.good : undefined}>
						{epoch ? (epoch.votingOpen ? duration(epoch.secondsUntilCutoff) : i18n._("Closed")) : "…"}
					</strong>
				</div>
				<div className={styles.stat}>
					<small>{i18n._("Your locks")}</small>
					<strong>{owner ? (locksData ? locksData.length : "…") : <span className={styles.dim}>{i18n._("Connect wallet")}</span>}</strong>
				</div>
				<div className={styles.stat}>
					<small>{i18n._("Locked SOLV3")}</small>
					<strong>{owner ? (locksData ? solv3(totalLocked) : "…") : <span className={styles.dim}>–</span>}</strong>
				</div>
			</section>

			<section className={styles.guide}>
				{steps.map((s, i) => (
					<div key={s.title} className={`${styles.step} ${s.done ? styles.done : ""}`}>
						<span className={styles.dot}>{s.done ? "✓" : i + 1}</span>
						<h3>{s.title}</h3>
						<p>{s.body}</p>
					</div>
				))}
			</section>

			{!owner && (
				<div className={styles.empty}>
					{i18n._("Connect your wallet (top right) to see your locks, rewards and this week's voting options.")}
				</div>
			)}

			{owner && (
				<div className={styles.card}>
					<div className={styles.reward}>
						<div>
							<div className={styles.rewardNum}>{claimData ? claimCount : "…"}</div>
							<div className={styles.rewardLabel}>
								{claimCount > 0
									? i18n._("voting rewards ready to claim")
									: i18n._("Nothing to claim yet. Rewards for a week unlock when that week ends.")}
							</div>
							{claimData?.rows.some((r) => r.autoVoteFeeBps > 0) && (
								<p className={styles.note}>{i18n._("Some rewards include a 15% fee because an auto-voter voted for you.")}</p>
							)}
						</div>
						<Button size="md" disabled={!claimCount || demo} loading={busy} onClick={() => onRun("v1/tx/claim-all", {})}>
							{i18n._("Claim all")}
						</Button>
					</div>
				</div>
			)}

			{owner && locksData?.length === 0 && (
				<div className={styles.empty}>{i18n._("This wallet has no locks yet. Create one below to start voting.")}</div>
			)}

			{owner &&
				locksData?.map((lock) => (
					<LockCard
						key={lock.id}
						lock={lock}
						pools={gaugesData?.gauges ?? []}
						epoch={epoch}
						plan={plansData?.find((p) => p.lockId === lock.id)}
						auto={autoInfoData?.available ? (autoStatusData?.locks.find((l) => l.lockId === lock.id) ?? { lockId: lock.id, enrolled: false, voter: null, usingAgent: false }) : undefined}
						feeBps={autoInfoData?.feeBps ?? 1500}
						busy={busy}
						demo={demo}
						onRun={onRun}
					/>
				))}

			{owner && <NewLock busy={busy} demo={demo} onRun={(amount) => onRun("v1/tx/lock", { amount })} />}

			{gaugesData && (
				<div className={styles.card}>
					<div>
						<h3 className={styles.cardTitle}>{i18n._("This week's pools")}</h3>
						<p className={styles.sub}>
							{i18n._("The share of all votes each pool has right now. A pool with fewer votes gives your vote a bigger share of its rewards.")}
						</p>
					</div>
					<div className={styles.pools}>
						{gaugesData.gauges.map((g) => (
							<div key={g.gauge} className={styles.pool} style={{ gridTemplateColumns: "minmax(0,1fr) auto" }}>
								<div className={styles.poolName}>
									<strong>{g.label}</strong>
									<div className={styles.bar}><i style={{ width: `${Math.max(2, Math.min(100, g.sharePercent))}%` }} /></div>
								</div>
								<div className={styles.poolMeta}>
									{g.sharePercent}% {i18n._("of votes")} · {g.bribes} {i18n._("bribes")}
								</div>
							</div>
						))}
					</div>
				</div>
			)}

			{!demo && (gauges.isError || locks.isError || claimable.isError || plans.isError) && (
				<div className={styles.empty}>{i18n._("The agent is unavailable right now. Try again in a minute.")}</div>
			)}
		</div>
	);
};

const LockCard: React.FC<{
	lock: AgentLock;
	pools: Pool[];
	epoch?: Gauges["epoch"];
	plan?: VotePlan;
	auto?: AutoStatus["locks"][number];
	feeBps: number;
	busy: boolean;
	demo: boolean;
	onRun: (path: string, body: Record<string, unknown>) => void;
}> = ({ lock, pools, epoch, plan, auto, feeBps, busy, demo, onRun }) => {
	const { i18n } = useLingui();
	const [alloc, setAlloc] = useState<Record<string, number>>({});
	const [more, setMore] = useState<string | number>("");
	const voted = !!epoch && lock.lastVoteEpoch === epoch.number;
	const open = epoch?.votingOpen ?? false;
	const total = Object.values(alloc).reduce((t, v) => t + (v || 0), 0);
	const picks = Object.entries(alloc).filter(([, v]) => v > 0);
	const valid = open && picks.length > 0 && total <= 100 && !demo;
	const suggestion = plan?.allocations ?? [];
	const notes = friendly(plan?.warnings ?? []);

	return (
		<div className={styles.card}>
			<div className={styles.cardHead}>
				<div>
					<h3 className={styles.cardTitle}>{i18n._("Lock #{id}", { id: lock.id })}</h3>
					<p className={styles.sub}>{solv3(lock.amount)} SOLV3 {i18n._("of voting power")}</p>
				</div>
				<div className={styles.chips}>
					<span className={`${styles.chip} ${voted ? styles.chipGood : styles.chipWarn}`}>
						{voted ? i18n._("Voted this week") : i18n._("Not voted yet")}
					</span>
					<span className={`${styles.chip} ${open ? styles.chipInfo : ""}`}>
						{open ? i18n._("Voting open") : i18n._("Voting closed")}
					</span>
				</div>
			</div>

			{suggestion.length > 0 ? (
				<div className={styles.suggest}>
					<span>
						{i18n._("Suggested: {split}", {
							split: suggestion.map((a) => `${a.percent}% ${pools.find((p) => p.gauge === a.gauge)?.label ?? ""}`).join(", "),
						})}
					</span>
					<Button size="xs" variant="light" onClick={() => setAlloc(Object.fromEntries(suggestion.map((a) => [a.gauge, a.percent])))}>
						{i18n._("Use this")}
					</Button>
				</div>
			) : (
				<p className={styles.sub}>{i18n._("Nothing stands out this week, so pick the pools yourself below.")}</p>
			)}
			{notes.map((n) => (
				<p key={n} className={styles.note}>{n}</p>
			))}

			<div className={styles.pools}>
				{pools.map((p, i) => (
					<div key={p.gauge} className={styles.pool}>
						<div className={styles.poolName}>
							<strong>
								<b style={{ display: "inline-block", width: 10, height: 10, borderRadius: 3, background: COLORS[i % COLORS.length], marginRight: 8 }} />
								{p.label}
							</strong>
							<span className={styles.poolMeta}>{i18n._("{share}% of votes now", { share: p.sharePercent })}</span>
						</div>
						<NumberInput
							min={0}
							max={100}
							step={5}
							allowDecimal={false}
							suffix="%"
							placeholder="0%"
							value={alloc[p.gauge] ?? ""}
							onChange={(v) => setAlloc((a) => ({ ...a, [p.gauge]: Number(v) || 0 }))}
						/>
					</div>
				))}
			</div>

			<div>
				<div className={styles.split}>
					{pools.map((p, i) => (alloc[p.gauge] ? <i key={p.gauge} style={{ width: `${Math.min(100, alloc[p.gauge] ?? 0)}%`, background: COLORS[i % COLORS.length] }} /> : null))}
				</div>
				<div className={styles.splitLegend} style={{ marginTop: 8, justifyContent: "space-between" }}>
					<span style={{ color: total > 100 ? "#ff7a7a" : "#a6a4b8" }}>
						{i18n._("Total {total}% of 100%", { total })}
					</span>
					<span>
						<Button size="compact-xs" variant="subtle" onClick={() => setAlloc(Object.fromEntries(pools.map((p) => [p.gauge, Math.floor(100 / Math.max(1, pools.length))])))}>
							{i18n._("Split evenly")}
						</Button>
						<Button size="compact-xs" variant="subtle" color="gray" onClick={() => setAlloc({})}>
							{i18n._("Clear")}
						</Button>
					</span>
				</div>
			</div>

			<Button
				size="md"
				disabled={!valid}
				loading={busy}
				onClick={() => onRun("v1/tx/vote", { lockId: lock.id, votes: picks.map(([gauge, percent]) => ({ gauge, percent })) })}
			>
				{voted ? i18n._("Change my vote") : i18n._("Vote")}
			</Button>

			{auto && <AutoVotePanel lockId={lock.id} auto={auto} feeBps={feeBps} busy={busy} demo={demo} onRun={onRun} />}

			<hr className={styles.divider} />
			<div className={styles.row}>
				<NumberInput label={i18n._("Add SOLV3 to this lock")} placeholder="0" min={0} decimalScale={9} w={200} value={more} onChange={setMore} />
				<Button
					variant="light"
					disabled={!Number(more) || demo}
					loading={busy}
					onClick={() => onRun("v1/tx/increase-lock", { lockId: lock.id, amount: String(more) })}
				>
					{i18n._("Add")}
				</Button>
			</div>
		</div>
	);
};

const AutoVotePanel: React.FC<{
	lockId: number;
	auto: AutoStatus["locks"][number];
	feeBps: number;
	busy: boolean;
	demo: boolean;
	onRun: (path: string, body: Record<string, unknown>) => void;
}> = ({ lockId, auto, feeBps, busy, demo, onRun }) => {
	const { i18n } = useLingui();
	const [ok, setOk] = useState(false);
	const pct = feeBps / 100;
	return (
		<div className={`${styles.auto} ${auto.usingAgent ? styles.autoOn : ""}`}>
			<div className={styles.autoHead}>
				<h4>{i18n._("Auto-vote")}</h4>
				<span className={`${styles.chip} ${auto.usingAgent ? styles.chipGood : ""}`}>
					{auto.usingAgent ? i18n._("ON") : i18n._("OFF")}
				</span>
			</div>
			{auto.usingAgent ? (
				<>
					<p className={styles.sub}>
						{i18n._("The agent votes this lock near the end of each week. If you vote yourself first, your vote is used and the agent leaves it alone.")}
					</p>
					<p className={styles.note}>
						{i18n._("While the agent votes for you, {pct}% of this lock's voting rewards go to the protocol. Weeks you vote yourself have no fee.", { pct })}
					</p>
					<div>
						<Button size="xs" variant="light" color="red" disabled={demo} loading={busy} onClick={() => onRun("v1/tx/autovote/disable", { lockId })}>
							{i18n._("Turn off")}
						</Button>
					</div>
				</>
			) : (
				<>
					<p className={styles.sub}>{i18n._("Let the agent vote this lock for you every week, so you never miss a vote.")}</p>
					<p className={styles.note}>
						{i18n._("It picks the best pools it can find near the end of the week. You can still vote yourself any time before voting closes, and your vote always wins.")}
					</p>
					<p className={styles.note}>
						{i18n._("Cost: {pct}% of this lock's voting rewards (trading fees and bribes) go to the protocol for weeks the agent votes. You can turn it off any time.", { pct })}
					</p>
					<Checkbox size="xs" checked={ok} onChange={(e) => setOk(e.currentTarget.checked)} label={i18n._("I understand the {pct}% fee", { pct })} />
					<div>
						<Button size="xs" disabled={!ok || demo} loading={busy} onClick={() => onRun("v1/tx/autovote/enable", { lockId })}>
							{i18n._("Turn on auto-vote")}
						</Button>
					</div>
				</>
			)}
		</div>
	);
};

const NewLock: React.FC<{ busy: boolean; demo: boolean; onRun: (amount: string) => void }> = ({ busy, demo, onRun }) => {
	const { i18n } = useLingui();
	const [amount, setAmount] = useState<string | number>("");
	const [ok, setOk] = useState(false);
	return (
		<div className={styles.card}>
			<div>
				<h3 className={styles.cardTitle}>{i18n._("Create a new lock")}</h3>
				<p className={styles.sub}>{i18n._("Locking SOLV3 gives you voting power 1 for 1. Locks are permanent. Exiting later costs a fee.")}</p>
			</div>
			<div className={styles.row}>
				<NumberInput label={i18n._("Amount of SOLV3")} placeholder="0" min={0} decimalScale={9} w={200} value={amount} onChange={setAmount} />
				<Button disabled={!ok || !Number(amount) || demo} loading={busy} onClick={() => onRun(String(amount))}>
					{i18n._("Lock")}
				</Button>
			</div>
			<Checkbox checked={ok} onChange={(e) => setOk(e.currentTarget.checked)} label={i18n._("I understand this lock is permanent")} />
		</div>
	);
};
