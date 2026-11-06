import type { NextConfig } from "next";

// Security headers applied to every response. This app is a Solana wallet
// / DEX frontend, so an XSS bug here is unusually high-impact (a malicious
// script could prompt the connected wallet to sign a draining transaction),
// which is why these are worth having even though the codebase has no
// obvious injection point today.
//
// script-src / style-src still include 'unsafe-inline' because the Next.js
// App Router injects inline bootstrap/streaming scripts and several UI
// libraries here (Mantine, GSAP) inject inline styles; neither is nonced.
// Tightening this to a nonce-based CSP (see Next's documented pattern:
// generate a nonce in middleware, thread it through request headers) is a
// recommended follow-up but touches shared routing middleware/rendering
// and needs real browser QA, so it's left as a recommendation rather than
// bundled into this mechanical fix.
const contentSecurityPolicy = [
	"default-src 'self'",
	process.env.NODE_ENV === "production"
		? "script-src 'self' 'unsafe-inline'"
		: "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
	"style-src 'self' 'unsafe-inline'",
	"img-src 'self' data: blob: https:",
	"font-src 'self' data:",
	// Broad connect-src: the app talks to whichever Solana RPC endpoint the
	// user/deployment configures (Helius, other providers, wallet-adapter
	// wallets' own endpoints), plus wallet APIs (WalletConnect relay,
	// Torus, Phantom, etc.) that aren't fixed, known hosts.
	"connect-src 'self' https: wss:",
	// Torus/WalletConnect wallet adapters render their UI in an iframe.
	"frame-src 'self' https:",
	"object-src 'none'",
	"base-uri 'self'",
	"form-action 'self'",
	"frame-ancestors 'self'",
	"upgrade-insecure-requests",
].join("; ");

const securityHeaders = [
	{ key: "Content-Security-Policy", value: contentSecurityPolicy },
	{ key: "X-Content-Type-Options", value: "nosniff" },
	{ key: "X-Frame-Options", value: "SAMEORIGIN" },
	{
		key: "Referrer-Policy",
		value: "strict-origin-when-cross-origin",
	},
	{
		key: "Permissions-Policy",
		value: "camera=(), microphone=(), geolocation=(), payment=()",
	},
	// Ignored by browsers unless the response was served over HTTPS, so this
	// is safe to send in every environment, including local HTTP dev.
	{
		key: "Strict-Transport-Security",
		value: "max-age=63072000; includeSubDomains; preload",
	},
];

const nextConfig: NextConfig = {
	outputFileTracingIncludes: { "/beta/alm/**": ["./alm-beta/**/*"] },
	async redirects() {
		// The v2 preview now lives at the main paths; keep old links working.
		return [
			{ source: "/v2", destination: "/arena", permanent: false },
			{ source: "/v2/demo", destination: "/arena/demo", permanent: false },
			{ source: "/v2/:path*", destination: "/:path*", permanent: false },
		];
	},
	async headers() {
		return [
			{
				source: "/:path*",
				headers: securityHeaders,
			},
			{
				source: "/assets/:path*",
				headers: [
					{
						key: "Cache-Control",
						value: "public, max-age=604800, stale-while-revalidate=31536000",
					},
				],
			},
		];
	},
	images: {
		// `next/image` is only ever used in this app with local assets under
		// /public (see src/components/Layout, src/components/Header, etc.).
		// Previously this allowed protocol:"https", hostname:"**", which
		// turns the built-in Next.js image optimizer (/_next/image?url=...)
		// into an open image proxy: it will server-side fetch and re-serve
		// ANY attacker-supplied HTTPS URL, which can be abused for SSRF
		// (probing internal/metadata endpoints from the server) and for
		// hotlinking/bandwidth abuse. No remote host is currently needed,
		// so remotePatterns is intentionally left empty. If a feature later
		// needs remote images via next/image (e.g. token logos), add only
		// the specific trusted hostname(s) here rather than a wildcard.
		remotePatterns: [],
		deviceSizes: [320, 428, 744, 1024, 1440, 1920, 2048],
		formats: ["image/avif", "image/webp"],
	},
	experimental: {
		// Keep production builds from saturating small/shared VPS hosts while
		// Next.js collects and prerenders routes. This only controls build-time
		// workers; it does not cap the running application's request handling.
		cpus: 2,
		optimizePackageImports: ["@mantine/core", "@mantine/hooks"],
		swcPlugins: [["@lingui/swc-plugin", {}]],
		reactCompiler: true,
	},
	turbopack: {
		rules: {
			"./src/locales/*.json": {
				loaders: ["@lingui/loader"],
				as: "*.js",
			},
		},
	},
	webpack(config, { isServer }) {
		config.module?.rules.push({
			test: /locales[\\/][^/]+\.json$/,
			loader: "@lingui/loader",
		});

		config.module.rules.push({
			test: /\.svg$/i,
			issuer: /\.[jt]sx?$/,
			use: ["@svgr/webpack"],
		});
		config.externals = [
			...(config.externals || []),
			"node-gyp-build",
			"pino-pretty",
		];

		config.externals.push({
			bufferutil: "bufferutil",
			"utf-8-validate": "utf-8-validate",
		});
		if (isServer) {
			if (Array.isArray(config.resolve.alias)) {
				config.resolve.alias.push({ name: "msw/browser", alias: false });
			} else {
				config.resolve.alias["msw/browser"] = false;
			}
		} else {
			if (Array.isArray(config.resolve.alias)) {
				config.resolve.alias.push({ name: "msw/node", alias: false });
			} else {
				config.resolve.alias["msw/node"] = false;
			}
		}

		// Keep Solana Mobile's browser exports intact. WalletProvider invokes
		// them on Android browsers even before a wallet is connected. Aliasing
		// these packages to false crashes the entire app during hydration.
		// The underlying bug — webpack resolving these packages' multi-
		// condition exports maps to a build missing createDefaultAddressSelector
		// et al. — is real and reproduces in production (confirmed live on
		// solve3.fi for real Android visitors), but every alias attempted here
		// either failed to resolve (these packages are only reachable as
		// nested transitive deps, not hoisted to root) or broke a different
		// import inside the same package chain. Mitigated instead with an
		// error boundary around the wallet provider tree (see
		// src/components/ErrorBoundary — WalletErrorBoundary in
		// providers/index.tsx) so this crash degrades to a fallback UI rather
		// than a blank page; the root cause remains open.

		return config;
	},
};

export default nextConfig;
