// Site variant: which of the two public sites this build serves.
//
// - "dev" (default): the full Solve3 app on devnet, served at dev.solve3.fi.
//   Every existing build keeps this behavior unless it opts in to "main".
// - "main": the mainnet site at solve3.fi. Swap, Pools, Rewards, Partners,
//   Simulator and Charter are open; other app routes show Coming Soon with a link
//   on the dev site. Pools are limited to MAINNET_LISTED_PAIRS.
//
// Keep this file free of React/DOM imports: it is consumed by the edge
// middleware as well as by client components.
export type SiteVariant = "main" | "dev";

export const SITE_VARIANT: SiteVariant =
	process.env.NEXT_PUBLIC_SITE_VARIANT === "main" ? "main" : "dev";

export const MAIN_SITE = SITE_VARIANT === "main";

const trimSlash = (url: string) => url.replace(/\/+$/, "");

export const DEV_SITE_URL = trimSlash(
	process.env.NEXT_PUBLIC_DEV_SITE_URL || "https://dev.solve3.fi",
);

export const MAIN_SITE_URL = trimSlash(
	process.env.NEXT_PUBLIC_MAIN_SITE_URL || "https://solve3.fi",
);

const SOL_MINT = "So11111111111111111111111111111111111111112";
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

/** Mint pairs (order-insensitive) the mainnet site lists, routes and values. */
export const MAINNET_LISTED_PAIRS: ReadonlyArray<readonly [string, string]> = [
	[SOL_MINT, USDC_MINT],
];

export const isListedPair = (mintA: string, mintB: string) =>
	MAINNET_LISTED_PAIRS.some(
		([a, b]) => (a === mintA && b === mintB) || (a === mintB && b === mintA),
	);

// Locale-stripped routes the mainnet site serves itself (exact route or any
// nested route beneath it). Everything else shows Coming Soon.
const MAIN_SITE_ROUTES = [
	"/charter",
	"/simulator",
	"/swap",
	"/liquidity",
	"/rewards",
	"/coming-soon",
	"/risk",
	"/legal",
	"/privacy",
	"/term",
	"/brand",
];

// Token listing requests stay on dev: mainnet lists only the pairs above,
// which are seeded by the team. /liquidity/create stays open because it is
// also the deposit flow for an existing pool; the mainnet Pools page hides
// its "Create pool" button.
const MAIN_SITE_CLOSED_ROUTES = ["/liquidity/request-token"];

const matches = (pathname: string, route: string) =>
	pathname === route || pathname.startsWith(`${route}/`);

/**
 * For the mainnet site, returns what a locale-stripped pathname should do
 * instead of rendering here: redirect to "/liquidity" for closed pool routes,
 * show Coming Soon for every other app route, or null when the main site
 * serves it.
 */
export function mainSiteRouteForPath(
	pathname: string,
): { kind: "redirect"; path: string } | { kind: "coming-soon" } | null {
	if (pathname === "/") return null;
	if (MAIN_SITE_CLOSED_ROUTES.some((route) => matches(pathname, route)))
		return { kind: "redirect", path: "/liquidity" };
	if (pathname === "/partners" || pathname === "/partners/") return null;
	if (MAIN_SITE_ROUTES.some((route) => matches(pathname, route))) return null;
	return { kind: "coming-soon" };
}

/** The same page on the dev site, for links out of the mainnet site. */
/** Pages that moved on the dev site: the mainnet "Try it on Dev" link should land on the new page. */
const DEV_PATH_FOR: Record<string, string> = { "/vote": "/arena" };
export const devSiteUrlFor = (pathname: string) => {
	const path = pathname.startsWith("/") ? pathname : "/";
	return `${DEV_SITE_URL}${DEV_PATH_FOR[path.replace(/\/$/, "")] ?? path}`;
};

/** Public information pages live on mainnet; partner account tools stay on dev. */
export const mainSiteUrlForPath = (pathname: string): string | null =>
	["/partners"].includes(pathname.replace(/\/$/, ""))
		? `${MAIN_SITE_URL}${pathname}`
		: null;
