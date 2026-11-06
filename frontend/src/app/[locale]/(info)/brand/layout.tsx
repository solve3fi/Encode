import { createPageMetadata } from "@/lib/metadata";

export const metadata = createPageMetadata(
	"Brand kit",
	"Download official Solve3 logos, brand guidance, colors, fonts, social templates, and partnership assets.",
	"/brand",
);

export default function Layout({ children }: { children: React.ReactNode }) {
	return children;
}
