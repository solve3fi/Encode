"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import Link from "next/link";
import { INTENTS_ENABLED } from "@/configs/intents";
import { useNativeBalance } from "@/hooks/useNativeBalance";

type Asset = "SOL" | "USDC" | "choose";
type Props = {
	/** "always" shows it whenever Intents is switched on; "low" only for a connected wallet that is short of SOL for fees. */
	when?: "always" | "low";
	/** The asset to receive. "choose" lets the person pick SOL or USDC. */
	asset?: Asset;
	title?: string;
	text?: string;
	/** Extra query for /fund, e.g. a return path. */
	className?: string;
};

const LOW_SOL = 0.5;

const Body: React.FC<Required<Pick<Props, "asset" | "title" | "text">>> = ({ asset, title, text }) => (
	<div
		role="note"
		style={{
			display: "flex",
			gap: "10px 16px",
			flexWrap: "wrap",
			alignItems: "center",
			justifyContent: "space-between",
			background: "rgba(88,215,255,0.07)",
			border: "1px solid rgba(88,215,255,0.28)",
			borderRadius: 14,
			padding: "12px 16px",
			margin: "0 auto 16px",
			maxWidth: 1120,
			width: "100%",
			boxSizing: "border-box",
		}}
	>
		<div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0, flex: "1 1 260px" }}>
			<strong style={{ fontSize: 14.5, color: "#F6F5F9" }}>{title}</strong>
			<span style={{ fontSize: 13, lineHeight: 1.5, color: "#C9C7D6" }}>
				{text} Moves real assets and settles on Solana mainnet.
			</span>
		</div>
		<div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
			{(asset === "choose" ? (["USDC", "SOL"] as const) : ([asset] as const)).map((a) => (
				<Link
					key={a}
					href={`/fund?to=${a}`}
					style={{
						display: "inline-flex",
						alignItems: "center",
						minHeight: 44,
						padding: "0 16px",
						borderRadius: 12,
						background: "#685DF7",
						color: "#fff",
						fontSize: 14,
						fontWeight: 600,
						textDecoration: "none",
					}}
				>
					{asset === "choose" ? `Get ${a}` : "Fund from any chain"}
				</Link>
			))}
		</div>
	</div>
);

const Low: React.FC<Required<Pick<Props, "asset" | "title" | "text">>> = (p) => {
	const { publicKey } = useWallet();
	const { data } = useNativeBalance();
	if (!publicKey || data === undefined || data >= LOW_SOL) return null;
	return <Body {...p} />;
};

/**
 * "Fund from any chain" prompt (Aurora Intents). Renders nothing unless NEXT_PUBLIC_INTENTS_ENABLED is on, so every
 * placement follows the same switch. Intents only delivers SOL or USDC to the connected Solana wallet.
 */
export const FundNudge: React.FC<Props> = ({
	when = "always",
	asset = "choose",
	title = "Need SOL or USDC?",
	text = "Bring it from any chain straight to your wallet.",
}) => {
	if (!INTENTS_ENABLED) return null;
	return when === "low" ? <Low asset={asset} title={title} text={text} /> : <Body asset={asset} title={title} text={text} />;
};
