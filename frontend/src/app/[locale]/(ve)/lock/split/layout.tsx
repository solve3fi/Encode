import { createPageMetadata } from "@/lib/metadata";
export const metadata = createPageMetadata("Split lock", "Split part of a permanent veSOLV3 lock into a new, separate lock.", "/lock/split");
// The page reads ?lockId= via useSearchParams, which Next.js can't statically
// prerender without a Suspense boundary — this route is inherently per-request.
export const dynamic = "force-dynamic";
export default function Layout({ children }: { children: React.ReactNode }) { return children; }
