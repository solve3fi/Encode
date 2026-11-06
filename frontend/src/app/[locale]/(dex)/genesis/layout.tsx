import { createPageMetadata } from "@/lib/metadata";

export const metadata = createPageMetadata(
	"Genesis",
	"Learn about the planned Solve3 Genesis campaign.",
	"/genesis",
);
export default function Layout({ children }: { children: React.ReactNode }) {
	return children;
}
