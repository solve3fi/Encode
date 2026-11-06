import { Container } from "@mantine/core";
import { AppLayout } from "@/components/Layout/AppLayout";
import { BoxLayout } from "@/components/Layout/BoxLayout";
import { Manager } from "@/components/Liquidity/Manager";

export default function ManagerLiquidity() {
	return (
		<AppLayout>
			<Container mx="auto" size="xl">
				<BoxLayout>
					<Manager />
				</BoxLayout>
			</Container>
		</AppLayout>
	);
}
