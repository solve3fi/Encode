import { createPageMetadata } from "@/lib/metadata";

export const metadata = createPageMetadata(
	"Quests & Pass",
	"Earn XP with Solve3 quests and keep your record on your Solve3 Pass.",
	"/quests",
);
export default function Layout({ children }: { children: React.ReactNode }) {
	return children;
}
