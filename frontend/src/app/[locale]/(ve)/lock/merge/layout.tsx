import { createPageMetadata } from "@/lib/metadata";
export const metadata = createPageMetadata("Merge locks", "Merge two of your permanent veSOLV3 locks into one.", "/lock/merge");
// The page reads ?lockId= via useSearchParams, which Next.js can't statically
// prerender without a Suspense boundary — this route is inherently per-request.
export const dynamic = "force-dynamic";
export default function Layout({ children }: { children: React.ReactNode }) { return children; }
