import { AppLayout } from "@/components/Layout/AppLayout";
import { ArenaDemoClient } from "@/components/V2/ArenaDemoClient";

export const metadata = {
	title: "Epoch Arena demo · Solve3",
	robots: { index: false, follow: false },
};

export default function ArenaDemoPage() {
	return (
		<AppLayout>
			<ArenaDemoClient />
		</AppLayout>
	);
}
