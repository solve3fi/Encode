"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { useQuery } from "@tanstack/react-query";
import BN from "bn.js";
import Link from "next/link";
import { useMemo } from "react";
import { getLockTokenInfo } from "@/configs/lock";
import { useAllPositions } from "@/hooks/useAllPositions";
import { useNativeBalance } from "@/hooks/useNativeBalance";
import { usePools } from "@/hooks/usePools";
import { usePositions } from "@/hooks/usePositions";
import { useAllTokens } from "@/hooks/useToken";
import { poll } from "@/lib/poll";
import { useAnchor } from "@/providers/DappProvider";
import { useLocks } from "@/stores/lock/hooks/useLocks";
import { ModalType } from "@/stores/modal";
import { useModalActions } from "@/stores/modal/ModalProvider";

const card: React.CSSProperties = {
	background: "#0E0E1C",
	border: "1px solid rgba(246,245,249,0.10)",
	borderRadius: 18,
	padding: 20,
	display: "flex",
	flexDirection: "column",
	gap: 12,
	minWidth: 0,
};
const row: React.CSSProperties = { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, minHeight: 36, fontSize: 14.5 };
const muted: React.CSSProperties = { color: "#A6A4B8", fontSize: 13 };
const linkStyle: React.CSSProperties = { color: "#8C84FF", fontWeight: 600, fontSize: 13.5, textDecoration: "none" };

const num = (n: number, max = 4) => new Intl.NumberFormat("en-US", { maximumFractionDigits: max }).format(n);
const short = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;

/** One read of every token account the wallet holds (not one request per token). */
const useWalletTokens = () => {
	const { connection, publicKey } = useAnchor();
	return useQuery({
		queryKey: ["wallet-token-accounts", publicKey?.toBase58()],
		enabled: Boolean(publicKey),
		queryFn: async () => {
			const res = await connection.getParsedTokenAccountsByOwner(publicKey, { programId: TOKEN_PROGRAM_ID });
			return res.value
				.map((a) => {
					const info = a.account.data.parsed.info as { mint: string; tokenAmount: { uiAmount: number | null } };
					return { mint: info.mint, amount: info.tokenAmount.uiAmount ?? 0 };
				})
				.filter((t) => t.amount > 0);
		},
		staleTime: 20_000,
		refetchInterval: poll(60_000),
	});
};

/**
 * What the wallet holds and has put to work: token balances, liquidity positions and locks, each linking to where it is
 * managed. Reads only; nothing here signs a transaction.
 */
export const WalletSummary: React.FC = () => {
	const { publicKey } = useWallet();
	const { setOpenModal } = useModalActions();
	const tokenMap = useAllTokens();
	const { data: sol } = useNativeBalance();
	const { data: tokens, isLoading: tokensLoading, isError: tokensError } = useWalletTokens();
	const { data: positionIds } = useAllPositions();
	const { data: positions } = usePositions(positionIds);
	const poolAddresses = useMemo(() => [...new Set((positions ?? []).map((p) => p.getData().solve.toString()))], [positions]);
	const { data: pools } = usePools(poolAddresses);
	const { data: locks } = useLocks();

	const pairOf = (poolAddr: string) => {
		const pool = (pools ?? []).find((p) => p.getAddress().toString() === poolAddr);
		if (!pool) return short(poolAddr);
		const d = pool.getData();
		const a = tokenMap[d.tokenMintA.toBase58()]?.symbol ?? short(d.tokenMintA.toBase58());
		const b = tokenMap[d.tokenMintB.toBase58()]?.symbol ?? short(d.tokenMintB.toBase58());
		return `${a}/${b}`;
	};

	if (!publicKey) {
		return (
			<section aria-label="Your wallet" style={{ ...card, alignItems: "flex-start" }}>
				<h2 style={{ margin: 0, fontSize: 18 }}>Your wallet</h2>
				<p style={{ ...muted, margin: 0, lineHeight: 1.5 }}>Connect a wallet to see your balances, liquidity positions and locks in one place.</p>
				<button
					type="button"
					onClick={() => setOpenModal(ModalType.WALLET)}
					style={{ font: "inherit", fontWeight: 600, fontSize: 15, minHeight: 48, padding: "0 22px", borderRadius: 12, border: 0, background: "#685DF7", color: "#fff", cursor: "pointer" }}
				>
					Connect wallet
				</button>
			</section>
		);
	}

	const held = (tokens ?? [])
		.map((t) => ({ ...t, info: tokenMap[t.mint] }))
		.sort((a, b) => Number(Boolean(b.info)) - Number(Boolean(a.info)) || b.amount - a.amount)
		.slice(0, 8);
	const positionRows = (positions ?? []).slice(0, 4);
	const lockRows = (locks ?? []).slice(0, 4);

	return (
		<section aria-label="Your wallet" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 16 }}>
			<div style={card}>
				<div style={row}>
					<h2 style={{ margin: 0, fontSize: 16 }}>Balances</h2>
					<Link href="/swap" style={linkStyle}>Swap →</Link>
				</div>
				<div style={row}>
					<span>SOL</span>
					<b>{sol === undefined ? "…" : num(sol)}</b>
				</div>
				{tokensLoading && <span style={muted}>Reading token accounts…</span>}
				{tokensError && <span style={muted}>Token balances are unavailable right now.</span>}
				{held.map((t) => (
					<div key={t.mint} style={row}>
						<span>{t.info?.symbol ?? short(t.mint)}</span>
						<b>{num(t.amount)}</b>
					</div>
				))}
				{!tokensLoading && !tokensError && held.length === 0 && <span style={muted}>No other tokens in this wallet yet.</span>}
				<span style={muted}>Amounts only; no USD value is shown for test tokens.</span>
			</div>

			<div style={card}>
				<div style={row}>
					<h2 style={{ margin: 0, fontSize: 16 }}>Liquidity positions</h2>
					<Link href="/liquidity" style={linkStyle}>Pools →</Link>
				</div>
				{positionRows.map((p) => {
					const addr = p.getAddress().toString();
					return (
						<div key={addr} style={row}>
							<span>{pairOf(p.getData().solve.toString())}</span>
							<Link href={`/liquidity/manager?positionId=${addr}`} style={linkStyle}>Manage</Link>
						</div>
					);
				})}
				{positionIds !== undefined && positionIds.length === 0 && <span style={muted}>No liquidity positions yet. Add liquidity from the Arena or Pools to start earning fees.</span>}
				{(positions?.length ?? 0) > positionRows.length && <span style={muted}>and {(positions?.length ?? 0) - positionRows.length} more, in Pools.</span>}
			</div>

			<div style={card}>
				<div style={row}>
					<h2 style={{ margin: 0, fontSize: 16 }}>Locks</h2>
					<Link href="/lock" style={linkStyle}>Lock →</Link>
				</div>
				{lockRows.map((l) => {
					const dec = getLockTokenInfo(l.lockTokenMint.toBase58()).decimals;
					const power = l.lockPower.div(new BN(10 ** dec)).toNumber();
					return (
						<div key={l.identifier.toString()} style={row}>
							<span>Lock #{l.identifier.toNumber()}</span>
							<span style={{ textAlign: "right" }}>
								<b>{num(power, 2)} veSOLV3</b>
								<br />
								<small style={muted}>{l.used ? "Voted this epoch" : "Not voted yet"}</small>
							</span>
						</div>
					);
				})}
				{locks !== undefined && locks.length === 0 && <span style={muted}>No locks yet. Lock SOLV3 to get voting power.</span>}
				{(locks?.length ?? 0) > lockRows.length && <span style={muted}>and {(locks?.length ?? 0) - lockRows.length} more, on the Lock page.</span>}
				{(locks?.length ?? 0) > 0 && <Link href="/arena" style={linkStyle}>Vote in the Arena →</Link>}
			</div>
		</section>
	);
};
