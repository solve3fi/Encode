import { ComingSoon } from "@/components/ComingSoon";
import { isGatedFeature } from "@/configs/launchPhase";

// Target of the middleware rewrite for gated ve routes (see src/middleware.ts).
// `feature` names the gated area so the copy matches the URL the visitor asked for.
export default async function ComingSoonPage({
	searchParams,
}: {
	searchParams: Promise<{ feature?: string }>;
}) {
	const { feature } = await searchParams;
	return <ComingSoon feature={isGatedFeature(feature) ? feature : null} />;
}
