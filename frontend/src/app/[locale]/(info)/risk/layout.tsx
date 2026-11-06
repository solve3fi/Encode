import { createPageMetadata } from "@/lib/metadata";
export const metadata = createPageMetadata(
	"Risk & admin roles",
	"Who can change the Solve3 programs, what each key can do, and what the audit does and does not cover.",
	"/risk",
);
export default function Layout({ children }: { children: React.ReactNode }) {
	return children;
}
