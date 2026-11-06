import { createPageMetadata } from "@/lib/metadata";
export const metadata = createPageMetadata("Exit lock", "Exit a permanent veSOLV3 lock early for a SOL fee and recover the full SOLV3 principal.", "/lock/exit");
// The page reads ?lockId= via useSearchParams, which Next.js can't statically
// prerender without a Suspense boundary — this route is inherently per-request.
export const dynamic = "force-dynamic";
export default function Layout({ children }: { children: React.ReactNode }) { return children; }
