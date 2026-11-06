import type { Metadata } from "next";

export const SITE_URL = new URL("https://solve3.fi");

export function createPageMetadata(
	title: string,
	description: string,
	path: string,
): Metadata {
	const pageTitle = `${title} · Solve3`;
	const canonical = new URL(path, SITE_URL).toString();
	const image = `/api/og?title=${encodeURIComponent(title)}`;
	return {
		metadataBase: SITE_URL,
		title: pageTitle,
		description,
		alternates: { canonical },
		openGraph: {
			type: "website",
			siteName: "Solve3",
			title: pageTitle,
			description,
			url: canonical,
			images: [{ url: image, width: 1200, height: 630, alt: pageTitle }],
		},
		twitter: {
			card: "summary_large_image",
			title: pageTitle,
			description,
			images: [image],
		},
	};
}
