import { type NextRequest, NextResponse } from "next/server";
import { i18nRouter } from "next-i18n-router";

import { GENESIS_PUBLIC_ENABLED } from "./configs/genesis";
import { DEX_ONLY, gatedFeatureForPath } from "./configs/launchPhase";
import { mainSiteUrlForPath } from "./configs/site";
import { i18n } from "./i18n/i18n-config";

// Strips a leading locale segment so gating sees the same path whether the
// request came in as /vote or /en/vote (prefixDefault is off, so both occur).
const stripLocale = (pathname: string): string => {
	for (const locale of i18n.locales) {
		if (pathname === `/${locale}`) return "/";
		if (pathname.startsWith(`/${locale}/`))
			return pathname.slice(locale.length + 1);
	}
	return pathname;
};

export function middleware(request: NextRequest) {
	// Standalone beta assets must keep their prefix. The dev-only route has its own feature gate.
	if (request.nextUrl.pathname === "/beta/alm" || request.nextUrl.pathname.startsWith("/beta/alm/"))
		return NextResponse.next();
    const mainnetUrl = mainSiteUrlForPath(stripLocale(request.nextUrl.pathname));
    if (mainnetUrl) {
        const url = new URL(mainnetUrl);
        url.pathname = request.nextUrl.pathname;
        url.search = request.nextUrl.search;
        return NextResponse.redirect(url);
    }
	// /v1 holds the old pages: gate them exactly like the paths they mirror.
	const feature = gatedFeatureForPath(stripLocale(request.nextUrl.pathname).replace(/^\/v1(?=\/|$)/, "") || "/");
	if (feature) {
		if (GENESIS_PUBLIC_ENABLED) {
			return NextResponse.redirect(new URL("/swap", request.url));
		}
		if (DEX_ONLY) {
			// Rewrite (not redirect): the address bar keeps /vote etc., the body
			// is the Coming Soon page, and the gated page never renders.
			const url = request.nextUrl.clone();
			url.pathname = `/${i18n.defaultLocale}/coming-soon`;
			url.search = `?feature=${feature}`;
			return NextResponse.rewrite(url);
		}
	}
	return i18nRouter(request, i18n);
}

export const config = {
	matcher: "/((?!api|media|static|.*\\..*|_next).*)",
};
