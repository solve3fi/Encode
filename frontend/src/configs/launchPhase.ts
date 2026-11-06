// Launch phase gate. The default is the full launch: every surface is open.
// Set NEXT_PUBLIC_LAUNCH_PHASE=dex to fall back to the DEX-only soft launch,
// where, with Genesis public mode off, the DEX phase keeps
// Swap and Pools open and shows ve(3,3) surfaces as Coming Soon. Explicit
// Genesis public mode takes precedence and shows Swap, Pools, Quests, and
// Genesis while keeping the ve surfaces closed. Only the full phase with
// Genesis public mode off opens ve flows.
//
// Keep this file free of React/DOM imports: it is consumed by the edge
// middleware as well as by client components.
export type LaunchPhase = "dex" | "full";

export const LAUNCH_PHASE: LaunchPhase =
	process.env.NEXT_PUBLIC_LAUNCH_PHASE === "dex" ? "dex" : "full";

export const DEX_ONLY = LAUNCH_PHASE === "dex";

export type GatedFeature =
	| "lock"
	| "vote"
	| "rewards"
	| "bribes"
	| "airdrop"
	| "presale"
	| "simulator"
	| "devnet";

export type GatedFeatureInfo = {
	title: string;
	blurb: string;
	/** Route prefixes (locale-stripped) that belong to this feature. */
	routes: string[];
};

// /admin is intentionally absent: it stays reachable (wallet-signature gated)
// so the Launch tab can seed the SOLV3 pools during the soft launch.
export const GATED_FEATURES: Record<GatedFeature, GatedFeatureInfo> = {
	lock: {
		title: "Lock",
		blurb:
			"Permanent SOLV3 locks and veSOLV3 voting power open with the veSOLV3 launch.",
		routes: ["/lock"],
	},
	vote: {
		title: "Vote",
		blurb: "Weekly gauge voting opens once veSOLV3 locks are live.",
		routes: ["/vote"],
	},
	rewards: {
		title: "Rewards",
		blurb:
			"Voting rewards and SOLV3 emissions start with the first voted epoch.",
		routes: ["/rewards"],
	},
	bribes: {
		title: "Bribes",
		blurb: "Voting incentives can be posted once gauge voting is live.",
		routes: ["/bribes"],
	},
	airdrop: {
		title: "Airdrop",
		blurb: "Airdrop claims open with the veSOLV3 launch.",
		routes: ["/airdrop"],
	},
	presale: {
		title: "Presale",
		blurb: "Presale claims open with the veSOLV3 launch.",
		routes: ["/presale"],
	},
	simulator: {
		title: "Simulator",
		blurb: "The rewards simulator returns when voting and emissions are live.",
		routes: ["/simulator"],
	},
	devnet: {
		title: "Devnet",
		blurb: "The devnet sandbox tools are not part of the soft launch.",
		routes: ["/devnet"],
	},
};

export const GATED_FEATURE_KEYS = Object.keys(GATED_FEATURES) as GatedFeature[];

export const isGatedFeature = (value: unknown): value is GatedFeature =>
	typeof value === "string" && value in GATED_FEATURES;

/**
 * Returns the gated feature that owns a locale-stripped pathname (exact route
 * or any nested route beneath it), or null when the path is open.
 */
export function gatedFeatureForPath(pathname: string): GatedFeature | null {
	for (const key of GATED_FEATURE_KEYS) {
		for (const route of GATED_FEATURES[key].routes) {
			if (pathname === route || pathname.startsWith(`${route}/`)) return key;
		}
	}
	return null;
}
