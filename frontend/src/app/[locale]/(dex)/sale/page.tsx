import { redirect } from "next/navigation";
import { AppLayout } from "@/components/Layout/AppLayout";
import { PresaleSale } from "@/components/PresaleSale/PresaleSale";
import { SALE_PAGE_ENABLED } from "@/configs/presaleSale";

// Presale round 2 (buy veSOLV3). The Friends & Family claim page stays at /presale, unchanged; it opens after the sale
// so both rounds can claim.
export default function Page() {
	// Hidden until NEXT_PUBLIC_PRESALE_SALE_ENABLED=true is set at build time.
	if (!SALE_PAGE_ENABLED) redirect("/arena");
	return (
		<AppLayout>
			<PresaleSale />
		</AppLayout>
	);
}
