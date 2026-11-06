import { TradeModes } from "@/components/Swap/TradeModes";
import { AppLayout } from "@/components/Layout/AppLayout";

export default function FundPage() {
	return (
		<AppLayout>
			<TradeModes initialMode="bridge" />
		</AppLayout>
	);
}
