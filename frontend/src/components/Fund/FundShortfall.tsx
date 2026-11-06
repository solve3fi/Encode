"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import type { TokenInfo } from "@solana/spl-token-registry";
import Link from "next/link";
import { INTENTS_ENABLED } from "@/configs/intents";
import { CurrencyBalance } from "../Token/CurrencyBalance";

// Intents only delivers SOL or USDC, so those are the only shortfalls it can fix.
const FUNDABLE: Record<string, "SOL" | "USDC"> = { SOL: "SOL", WSOL: "SOL", USDC: "USDC", DEVUSDC: "USDC" };

type Props = { symbol?: string; amount?: number; balance: number; loading?: boolean };

/** Inline "you need more of this token" note with a Fund link, shown only when the typed amount is above the wallet balance. */
export const FundShortfall: React.FC<Props> = ({ symbol, amount, balance, loading }) => {
	const { publicKey } = useWallet();
	if (!INTENTS_ENABLED || !publicKey || loading) return null;
	const to = symbol ? FUNDABLE[symbol.toUpperCase()] : undefined;
	if (!to || !amount || !(amount > 0) || !Number.isFinite(balance) || amount <= balance) return null;
	const short = (amount - balance).toLocaleString("en-US", { maximumFractionDigits: 4 });
	return (
		<div
			role="note"
			style={{
				display: "flex",
				gap: "6px 12px",
				flexWrap: "wrap",
				alignItems: "center",
				justifyContent: "space-between",
				marginTop: 10,
				padding: "8px 12px",
				borderRadius: 10,
				background: "rgba(88,215,255,0.07)",
				border: "1px solid rgba(88,215,255,0.28)",
				fontSize: 13,
				color: "#C9C7D6",
			}}
		>
			<span>
				You need {short} more {symbol}. Bring it from any chain.
			</span>
			<Link href={`/fund?to=${to}`} style={{ fontWeight: 600, color: "#58D7FF", textDecoration: "none", minHeight: 24, display: "inline-flex", alignItems: "center" }}>
				Get {to} →
			</Link>
		</div>
	);
};

/** Same note for a TokenInfo, reading the wallet balance itself. */
export const CurrencyShortfall: React.FC<{ currency?: TokenInfo | null; amount?: number }> = ({ currency, amount }) => (
	<CurrencyBalance currency={currency}>
		{({ balance, loading }) => <FundShortfall symbol={currency?.symbol} amount={amount} balance={Number(balance)} loading={loading} />}
	</CurrencyBalance>
);
