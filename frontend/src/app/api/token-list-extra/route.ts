import type { TokenInfo, TokenList } from "@solana/spl-token-registry";
import { NextResponse } from "next/server";
import {
	TOKEN_REQUESTS_STORE,
	type TokenRequestsById,
} from "@/configs/tokenRequests";
import { readStore } from "@/lib/server/dataStore";

export const runtime = "nodejs";

// Devnet's SLIP-44-style chain id, matching CLUSTER_CHAINS[ClusterNetwork.Devnet]
// in src/providers/ClusterProvider.tsx. Not imported directly — that module is
// "use client", and importing its exports into a server route handler crosses
// the RSC client/server boundary, which silently turned this into `undefined`
// (dropped by JSON.stringify) instead of the real value.
const DEVNET_CHAIN_ID = 102;

// Public — the same standard token-list shape fetchTokenList() already
// returns for the checked-in default.tokenlist.json, just built from
// admin-approved community submissions instead of a static file. Consumed
// by useAllTokens() (see src/hooks/useToken.ts) so approval alone is
// enough to make a pool show branded everywhere, no redeploy required.
export async function GET() {
	const requests = await readStore<TokenRequestsById>(TOKEN_REQUESTS_STORE, {});

	const tokens: TokenInfo[] = Object.values(requests)
		.filter((request) => request.status === "approved")
		.map((request) => ({
			chainId: DEVNET_CHAIN_ID,
			address: request.mint,
			symbol: request.symbol,
			name: request.name,
			decimals: request.decimals,
			logoURI: `/api/token-logos/${request.logoFile}`,
			tags: ["community-verified"],
			extensions: {
				...(request.website ? { website: request.website } : {}),
				...(request.twitter ? { twitter: request.twitter } : {}),
			},
		}));

	const list: TokenList = {
		name: "solve3 community-approved",
		logoURI: "",
		tags: {},
		timestamp: new Date().toISOString(),
		tokens,
	};
	return NextResponse.json(list);
}
