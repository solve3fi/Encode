import type { MetadataRoute } from "next";
import { DEX_ONLY, gatedFeatureForPath } from "@/configs/launchPhase";
import { SITE_URL } from "@/lib/metadata";

export default function sitemap(): MetadataRoute.Sitemap {
	const allRoutes = ["", "/swap", "/arena", "/liquidity", "/lock", "/vote", "/rewards", "/quests", "/pass", "/partners", "/charter", "/risk", "/simulator", "/privacy", "/term"];
	// Gated ve routes only serve the Coming Soon page during the soft launch.
	const routes = DEX_ONLY ? allRoutes.filter((route) => gatedFeatureForPath(route) === null) : allRoutes;
	return routes.map((route) => ({
		url: new URL(route || "/", SITE_URL).toString(),
		lastModified: new Date(),
		changeFrequency: route === "" ? "weekly" : "daily",
		priority: route === "" ? 1 : route === "/vote" || route === "/lock" ? 0.9 : 0.7,
	}));
}
