"use client";

import { PublicKey } from "@solana/web3.js";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { getGaugePDA, getProtocolPDA } from "@/hooks/useVesolveProgram";
import { useArenaGauges } from "../V2/useArenaGauges";
import { useQuestSession } from "@/components/QuestTest/QuestSessionProvider";
import { useModalActions } from "@/stores/modal/ModalProvider";
import { VoteProvider } from "@/stores/vote/VoteProvider";
import { ModalType } from "@/stores/modal";
import classes from "./Clans.module.css";
import { CLAN_MESSAGES, type BoardClan, type ClanMember, type MyClan, useClans } from "./useClans";

const n = (v: number) => v.toLocaleString("en-US", { maximumFractionDigits: 0 });
const daysLeft = (iso: string) => Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000));

/** Quests, Clans tab. A clan is a scoring and social group: it never adds, pools or delegates voting power. */
export const ClansTab: React.FC = () => {
	const { state, wallet, network } = useQuestSession();
	const { setOpenModal } = useModalActions();
	const { ready, overview, board, loading, busy, error, act, search } = useClans();
	const status = (state as { status: string; error?: string | null }).status;
	const [notice, setNotice] = useState<{ tone: "ok" | "warn"; text: string } | null>(null);
	const [pendingCode, setPendingCode] = useState("");

	// A friend's invite link (...?tab=clans&invite=CODE) pre-fills the join box.
	useEffect(() => {
		const code = new URLSearchParams(window.location.search).get("invite");
		if (code && /^[A-Za-z0-9]{8}$/.test(code)) setPendingCode(code.toUpperCase());
	}, []);

	const result = async (action: string, params: Record<string, unknown>, okText: string) => {
		setNotice(null);
		const word = await act(action, params);
		if (word === undefined) return word;
		if (word === "OK") setNotice({ tone: "ok", text: okText });
		else if (CLAN_MESSAGES[word]) setNotice({ tone: "warn", text: CLAN_MESSAGES[word] });
		else setNotice({ tone: "ok", text: okText });
		return word;
	};

	if (!wallet || network !== "devnet") {
		return (
			<section className={classes.panel} aria-label="Clans">
				<span className={classes.eyebrow}>Clans</span>
				<h2>Play with a crew.</h2>
				<p className={classes.muted}>
					Clans rally votes behind pools. A leader picks up to three, and members vote for them with their own veSOLV3. Voting power is never pooled. Connect a devnet wallet to find or start one.
				</p>
				<div className={classes.inline}>
					<button type="button" className={classes.btn} onClick={() => setOpenModal(ModalType.WALLET)}>Connect wallet</button>
				</div>
			</section>
		);
	}

	if (!ready) {
		return (
			<section className={classes.panel} aria-label="Clans" role="status">
				<span className={classes.eyebrow}>Clans</span>
				<p className={classes.muted}>
					{status === "SIGNING"
						? "Approve the sign-in message in your wallet to see clans."
						: status === "LOADING"
							? "Loading your clans…"
							: "Signing you in…"}
				</p>
			</section>
		);
	}

	if (!overview) {
		return (
			<section className={classes.panel} aria-label="Clans" aria-busy="true">
				<span className={classes.eyebrow}>Clans</span>
				{error ? <p className={`${classes.note} ${classes.err}`} role="alert">{error}</p> : <div className={classes.skeleton} />}
			</section>
		);
	}

	const clan = overview.clan;
	return (
		<div className={classes.page}>
			{error && <p className={`${classes.note} ${classes.err}`} role="alert">{error}</p>}
			{notice && <p className={`${classes.note} ${notice.tone === "warn" ? classes.warn : ""}`} role="status">{notice.text}</p>}
			{clan ? (
				<ClanHome
					clan={clan}
					board={board?.clans ?? []}
					season={overview.season}
					maxMembers={overview.maxMembers}
					busy={busy}
					onKick={(m) => result("kick", { memberRef: m.ref }, `${m.alias} was removed from the clan.`)}
					onLeave={() => result("leave", {}, "You left the clan.")}
					onRally={(pool, removeGauge) => {
						if (pool) {
							const [protocol] = getProtocolPDA();
							const [gauge] = getGaugePDA(protocol, new PublicKey(pool.addr));
							return result("rally-add", { gauge: gauge.toBase58(), pool: pool.addr, label: pool.name }, `${pool.name} is now a rally pool.`);
						}
						return result("rally-remove", { gauge: removeGauge }, "Rally pool removed.");
					}}
					onInvite={async () => {
						const word = await act("invite", {});
						if (word && !/^[A-HJ-NP-Z2-9]{8}$/.test(word) && CLAN_MESSAGES[word]) setNotice({ tone: "warn", text: CLAN_MESSAGES[word] });
					}}
				/>
			) : (
				<Finder
					overview={overview}
					clans={board?.clans ?? []}
					total={board?.total ?? 0}
					loading={loading}
					busy={busy}
					pendingCode={pendingCode}
					onSearch={search}
					onJoin={(id) => result("join", { clanId: id, code: null }, "You joined the clan.")}
					onJoinCode={(code) => result("join", { clanId: null, code }, "You joined the clan.")}
					onCreate={(name, tag) => result("create", { name, tag }, "Your clan is live. Invite friends from the clan page.")}
				/>
			)}
		</div>
	);
};

const Finder: React.FC<{
	overview: NonNullable<ReturnType<typeof useClans>["overview"]>;
	clans: BoardClan[];
	total: number;
	loading: boolean;
	busy: boolean;
	pendingCode: string;
	onSearch: (q: string) => void;
	onJoin: (id: string) => Promise<string | undefined>;
	onJoinCode: (code: string) => Promise<string | undefined>;
	onCreate: (name: string, tag: string) => Promise<string | undefined>;
}> = ({ overview, clans, total, loading, busy, pendingCode, onSearch, onJoin, onJoinCode, onCreate }) => {
	const [q, setQ] = useState("");
	const [name, setName] = useState("");
	const [tag, setTag] = useState("");
	const [code, setCode] = useState(pendingCode);
	useEffect(() => setCode(pendingCode), [pendingCode]);
	const first = useRef(true);
	useEffect(() => {
		// The board is already loaded with the overview; only a typed search needs another read.
		if (first.current) {
			first.current = false;
			return;
		}
		const t = window.setTimeout(() => onSearch(q), 250);
		return () => window.clearTimeout(t);
	}, [q, onSearch]);

	return (
		<div className={classes.cols}>
			<section className={classes.panel} aria-label="Find a clan">
				<span className={classes.eyebrow}>Clans</span>
				<h2>Find a clan</h2>
				<p className={classes.muted}>
					{overview.season ? `${overview.season.label} ends in ${daysLeft(overview.season.endsAt)} days. ` : ""}
					Clans are ranked by how many members back their rally pools this epoch. Everyone votes with their own power; nothing is pooled.
				</p>
				{!overview.eligible && (
					<p className={`${classes.note} ${classes.warn}`}>Mint your Solve3 Pass, or vote with a veSOLV3 lock, to join or start a clan.</p>
				)}
				<label className={classes.field}>
					Search by name or tag
					<input className={classes.input} value={q} maxLength={24} onChange={(e) => setQ(e.target.value)} placeholder="Search clans" aria-label="Search clans" />
				</label>
				<div className={classes.list} aria-busy={loading}>
					{clans.length === 0 && (
						<p className={classes.muted}>{total === 0 && !q ? "No clans yet. Start the first one." : "No clans match that search."}</p>
					)}
					{clans.map((c) => (
						<div className={classes.row} key={c.id} data-mine={c.isMine}>
							<span className={classes.rank} data-top={c.rank <= 3}>{c.rank}</span>
							<span className={classes.who}>
								<strong>{c.name} <span>· {c.tag}</span></strong>
								<span>{c.members} of {c.maxMembers} members</span>
							</span>
							<span className={classes.num}>{n(c.score)} backing</span>
							<button type="button" className={`${classes.btn} ${classes.small}`} disabled={busy || !overview.eligible || c.members >= c.maxMembers} onClick={() => void onJoin(c.id)}>
								{c.members >= c.maxMembers ? "Full" : "Join"}
							</button>
						</div>
					))}
				</div>
			</section>

			<div className={classes.stack}>
				<section className={classes.panel} aria-label="Start a clan">
					<h2>Start a clan</h2>
					<form
						className={classes.form}
						onSubmit={(e) => {
							e.preventDefault();
							void onCreate(name.trim(), tag.trim());
						}}
					>
						<label className={classes.field}>
							Clan name
							<input className={classes.input} value={name} maxLength={24} onChange={(e) => setName(e.target.value)} placeholder="Moon Cats" />
						</label>
						<label className={classes.field}>
							Tag (3 or 4 letters or numbers)
							<input className={classes.input} value={tag} maxLength={4} onChange={(e) => setTag(e.target.value.toUpperCase())} placeholder="MCAT" />
						</label>
						<button type="submit" className={classes.btn} disabled={busy || !overview.eligible || name.trim().length < 3 || tag.trim().length < 3}>
							Create clan
						</button>
					</form>
				</section>
				<section className={classes.panel} aria-label="Join with an invite">
					<h2>Have an invite code?</h2>
					<form
						className={classes.inline}
						onSubmit={(e) => {
							e.preventDefault();
							void onJoinCode(code.trim().toUpperCase());
						}}
					>
						<input className={classes.input} style={{ flex: "1 1 160px", width: "auto" }} value={code} maxLength={8} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="8-character code" aria-label="Invite code" />
						<button type="submit" className={classes.ghost} disabled={busy || !overview.eligible || !/^[A-Z0-9]{8}$/.test(code)}>Join</button>
					</form>
				</section>
			</div>
		</div>
	);
};

const ClanHome: React.FC<{
	clan: MyClan;
	board: BoardClan[];
	season: { label: string; endsAt: string } | null;
	maxMembers: number;
	busy: boolean;
	onKick: (m: ClanMember) => void;
	onLeave: () => void;
	onInvite: () => void;
	onRally: (pool: { addr: string; name: string } | null, removeGauge?: string) => void;
}> = ({ clan, board, season, maxMembers, busy, onKick, onLeave, onInvite, onRally }) => {
	const [copied, setCopied] = useState(false);
	const [confirmLeave, setConfirmLeave] = useState(false);
	const leader = board[0];
	const leading = leader?.id === clan.id;
	const gap = leader && !leading ? Math.max(0, leader.score - clan.score) : 0;
	const link = clan.invite && typeof window !== "undefined" ? `${window.location.origin}/quests?tab=clans&invite=${clan.invite}` : "";
	const voted = clan.voting ? Math.round((clan.voting.voted / Math.max(1, clan.voting.members)) * 100) : 0;

	return (
		<div className={classes.cols}>
			<div className={classes.stack}>
				<section className={classes.panel} aria-label="My clan">
					<div className={classes.head}>
						<div className={classes.title}>
							<span className={classes.badge} aria-hidden="true">{clan.tag}</span>
							<div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
								<strong>{clan.name}</strong>
								<span>{clan.role === "LEADER" ? "You lead this clan" : "Member"} · {clan.members} of {maxMembers} members</span>
							</div>
						</div>
						{!confirmLeave ? (
							<button type="button" className={`${classes.ghost} ${classes.danger}`} disabled={busy} onClick={() => setConfirmLeave(true)}>Leave clan</button>
						) : (
							<div className={classes.inline}>
								<button type="button" className={`${classes.ghost} ${classes.danger}`} disabled={busy} onClick={onLeave}>Yes, leave</button>
								<button type="button" className={classes.ghost} onClick={() => setConfirmLeave(false)}>Stay</button>
							</div>
						)}
					</div>
					<div className={classes.tiles}>
						<div className={classes.tile}><span>Backing the rally</span><strong>{n(clan.score)}</strong><em>members who voted for a rally pool this epoch</em></div>
						<div className={classes.tile}><span>Rally pools</span><strong>{clan.rallies.length} of 3</strong><em>{season ? `${season.label}, ${daysLeft(season.endsAt)} days left` : "chosen by the leader"}</em></div>
						<div className={classes.tile}><span>Rank</span><strong>#{clan.rank}</strong><em>of {board.length > 0 ? "all live clans" : "the board"}</em></div>
						<div className={classes.tile}><span>Quest XP this week</span><strong>{n(clan.weekXp)}</strong><em>each member keeps their own</em></div>
					</div>
				</section>

				<section className={classes.panel} aria-label="Clan war">
					<span className={classes.eyebrow}>Clan war{season ? ` · ${season.label}` : ""}</span>
					<div className={classes.war}>
						<strong style={{ fontSize: 16, color: "#f6f5f9" }}>
							{leading ? `${clan.name} leads the board.` : leader ? `${leader.name} leads. Your clan trails by ${n(gap)} ${gap === 1 ? "voter" : "voters"}.` : "No standings yet."}
						</strong>
						<div className={classes.bar} role="img" aria-label="Your score against the leader">
							<span style={{ width: `${leader && leader.score > 0 ? Math.min(100, (clan.score / leader.score) * 100) : leading ? 100 : 0}%` }} />
						</div>
						<p className={classes.muted}>Clans are ranked by members who back a rally pool this epoch. Each member votes with their own veSOLV3; nothing is pooled or delegated.</p>
					</div>
				</section>

				<VoteProvider>
					<RallyPanel clan={clan} busy={busy} onAdd={onRally} onRemove={(gauge) => onRally(null, gauge)} />
				</VoteProvider>

				<section className={classes.panel} aria-label="Where members voted">
					<span className={classes.eyebrow}>Clan participation</span>
					{clan.voting ? (
						<>
							<strong style={{ color: "#f6f5f9" }}>{clan.voting.voted} of {clan.voting.members} members voted in epoch {clan.voting.epoch}</strong>
							<div className={classes.bar} role="img" aria-label={`${voted}% of members voted`}><span style={{ width: `${voted}%` }} /></div>
						</>
					) : (
						<p className={classes.muted}>Shown once the clan has at least three members. Only the aggregate is shown, never an individual vote.</p>
					)}
				</section>

				<section className={classes.panel} aria-label="Members">
					<span className={classes.eyebrow}>Members</span>
					<div className={classes.list}>
						{clan.membersList.map((m, i) => (
							<div className={classes.row} key={m.ref} data-mine={m.isMe}>
								<span className={classes.rank} data-top={i < 3 && m.xp > 0}>{i + 1}</span>
								<span className={classes.who}>
									<strong>{m.alias}{m.isMe ? " (you)" : ""}</strong>
									<span>{m.role === "LEADER" ? "Leader" : "Member"} · joined {new Date(m.joinedAt).toLocaleDateString()}</span>
								</span>
								<span className={classes.num}>{n(m.xp)} XP</span>
								{clan.role === "LEADER" && !m.isMe ? (
									<button type="button" className={`${classes.ghost} ${classes.small} ${classes.danger}`} disabled={busy} onClick={() => onKick(m)} aria-label={`Remove ${m.alias}`}>Remove</button>
								) : (
									<span />
								)}
							</div>
						))}
					</div>
				</section>
			</div>

			<div className={classes.stack}>
				<section className={classes.panel} aria-label="Invite friends">
					<h2>Invite friends</h2>
					{clan.role === "LEADER" ? (
						clan.invite ? (
							<>
								<p className={classes.muted}>Share this link. It works for 14 days or 25 joins.</p>
								<code style={{ fontSize: 13, wordBreak: "break-all", color: "#c9c7d6" }}>{link.replace(/^https?:\/\//, "")}</code>
								<button
									type="button"
									className={classes.btn}
									onClick={() => navigator.clipboard.writeText(link).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1500); })}
								>
									{copied ? "Copied" : "Copy invite link"}
								</button>
							</>
						) : (
							<>
								<p className={classes.muted}>Create a link friends can use to join.</p>
								<button type="button" className={classes.btn} disabled={busy} onClick={onInvite}>Create invite link</button>
							</>
						)
					) : (
						<p className={classes.muted}>Ask your clan leader for an invite link.</p>
					)}
				</section>

				<section className={classes.panel} aria-label="Top clans">
					<h2>Top clans</h2>
					<div className={classes.list}>
						{board.slice(0, 5).map((c) => (
							<div className={classes.row} key={c.id} data-mine={c.isMine} style={{ gridTemplateColumns: "34px minmax(0, 1fr) auto" }}>
								<span className={classes.rank} data-top={c.rank <= 3}>{c.rank}</span>
								<span className={classes.who}><strong>{c.name}</strong><span>{c.tag} · {c.members} members</span></span>
								<span className={classes.num}>{n(c.score)} backing</span>
							</div>
						))}
					</div>
				</section>

				<section className={classes.panel} aria-label="Clan perks">
					<h2>Clan perks</h2>
					<div className={classes.list}>
						<div className={classes.row} style={{ gridTemplateColumns: "minmax(0, 1fr) auto" }}><span className={classes.who}><strong>Clan badge on the board</strong></span><span className={classes.num} style={{ color: "#58d7ff" }}>Included</span></div>
						<div className={classes.row} style={{ gridTemplateColumns: "minmax(0, 1fr) auto" }}><span className={classes.who}><strong>Clan of the Epoch</strong><span>Shown on the Arena winners strip</span></span><span className={classes.num} style={{ color: "#a6a4b8" }}>Coming soon</span></div>
						<div className={classes.row} style={{ gridTemplateColumns: "minmax(0, 1fr) auto" }}><span className={classes.who}><strong>Genesis XP boost</strong><span>For clans in the top tier</span></span><span className={classes.num} style={{ color: "#a6a4b8" }}>Not live yet</span></div>
					</div>
					<p className={classes.muted}>Perks are non-token in this release. Clans never share rewards or voting power.</p>
				</section>
			</div>
		</div>
	);
};

type ArenaPool = { addr: string; name: string };

/** The gauge pools, read live (shared with the Arena's cache), for the leader's picker. */
const LeaderPicker: React.FC<{ taken: Set<string>; busy: boolean; onAdd: (pool: { addr: string; name: string }) => void }> = ({ taken, busy, onAdd }) => {
	const { rows, isLoading, error } = useArenaGauges();
	const [pick, setPick] = useState("");
	const options = rows.filter((r) => !taken.has(r.addr)).map((r) => ({ addr: r.addr, name: r.name }));
	if (isLoading && options.length === 0) return <p className={classes.muted} role="status">Loading pools…</p>;
	if (error && options.length === 0) return <p className={classes.muted}>Could not load pools. Refresh to try again.</p>;
	if (options.length === 0) return <p className={classes.muted}>Every gauge pool is already a rally pool.</p>;
	return (
		<div className={classes.inline}>
			<select className={classes.input} aria-label="Pool to rally" value={pick} onChange={(e) => setPick(e.target.value)}>
				<option value="">Choose a pool</option>
				{options.map((p) => (
					<option key={p.addr} value={p.addr}>{p.name}</option>
				))}
			</select>
			<button
				type="button"
				className={classes.btn}
				disabled={busy || !pick}
				onClick={() => {
					const p = options.find((o) => o.addr === pick);
					if (p) {
						onAdd(p);
						setPick("");
					}
				}}
			>
				Rally this pool
			</button>
		</div>
	);
};

/** Rally pools: up to three pools the leader asks the clan to back. Members vote with their own veSOLV3 in the Arena. */
const RallyPanel: React.FC<{
	clan: MyClan;
	busy: boolean;
	onAdd: (pool: { addr: string; name: string } | null, removeGauge?: string) => void;
	onRemove: (gauge: string) => void;
}> = ({ clan, busy, onAdd, onRemove }) => {
	const taken = new Set(clan.rallies.map((r) => r.pool));
	const leader = clan.role === "LEADER";
	return (
		<section className={classes.panel} aria-label="Rally pools">
			<span className={classes.eyebrow}>Rally pools</span>
			<h2>Where the clan is voting</h2>
			<p className={classes.muted}>
				The leader picks up to three pools. Members vote for them with their own veSOLV3 in the Arena. Only the number of members backing each pool is shown, never an individual vote.
			</p>
			{clan.rallies.length === 0 ? (
				<p className={classes.muted}>{leader ? "No rally pool yet. Pick one below to point your clan at it." : "Your leader has not picked a rally pool yet."}</p>
			) : (
				<div className={classes.list}>
					{clan.rallies.map((r) => {
						const pct = r.backed !== null ? Math.round((r.backed / Math.max(1, r.members)) * 100) : 0;
						return (
							<div className={classes.row} key={r.gauge} style={{ gridTemplateColumns: "minmax(0, 1fr) auto auto" }}>
								<span className={classes.who}>
									<strong>{r.label}</strong>
									<span>{r.backed !== null ? `${r.backed} of ${r.members} members backing` : "Backing shown once the clan has three members"}</span>
									{r.backed !== null && (
										<div className={classes.bar} role="img" aria-label={`${pct}% of members back ${r.label}`}><span style={{ width: `${pct}%` }} /></div>
									)}
								</span>
								<Link href="/arena#rally" className={`${classes.btn} ${classes.small}`} style={{ textDecoration: "none" }}>Vote</Link>
								{leader ? (
									<button type="button" className={`${classes.ghost} ${classes.small} ${classes.danger}`} disabled={busy} onClick={() => onRemove(r.gauge)} aria-label={`Stop rallying ${r.label}`}>Remove</button>
								) : (
									<span />
								)}
							</div>
						);
					})}
				</div>
			)}
			{leader && clan.rallies.length < 3 && <LeaderPicker taken={taken} busy={busy} onAdd={onAdd} />}
		</section>
	);
};
