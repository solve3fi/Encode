import { ImageResponse } from "next/og";
import type { NextRequest } from "next/server";
import { tokenValues } from "@/theme/tokenValues";

export const runtime = "edge";

export function GET(request: NextRequest) {
	const title = request.nextUrl.searchParams.get("title") || "Protocol";
	return new ImageResponse(
		<div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: "72px", background: tokenValues.surfaceBase, color: tokenValues.textPrimary, fontFamily: "sans-serif" }}>
			<div style={{ display: "flex", alignItems: "center", gap: "18px", fontSize: 34, letterSpacing: "-0.04em" }}>
				<span style={{ width: 28, height: 28, border: `7px solid ${tokenValues.accent}`, borderRadius: 999 }} />
				Solve3
			</div>
			<div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
				<div style={{ color: tokenValues.info, fontSize: 20, letterSpacing: "0.16em", textTransform: "uppercase" }}>Solana liquidity coordination</div>
				<div style={{ fontSize: 96, lineHeight: 0.94, letterSpacing: "-0.06em" }}>{title}</div>
			</div>
			<div style={{ display: "flex", justifyContent: "space-between", color: tokenValues.textSecondary, fontSize: 22 }}>
				<span>Permanent locks · Weekly votes · Directed emissions</span>
				<span>solve3.fi</span>
			</div>
		</div>,
		{ width: 1200, height: 630 },
	);
}
