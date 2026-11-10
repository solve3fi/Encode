import { Container } from "@mantine/core";
import { AppLayout } from "@/components/Layout/AppLayout";
import { Manager } from "@/components/Liquidity/Manager";

export default function ManagerLiquidity() {
	return (
		<AppLayout>
			<Container mx="auto" size="xl">
				<div style={{ padding: "8px 0 16px" }}>
					<Manager />
				</div>
			</Container>
		</AppLayout>
	);
}
