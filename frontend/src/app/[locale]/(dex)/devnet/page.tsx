import { Container } from "@mantine/core";
import { AppLayout } from "@/components/Layout/AppLayout";
import { BoxLayout } from "@/components/Layout/BoxLayout";
import { Devnet } from "@/components/Devnet";

export default function DevnetPage() {
	return (
		<AppLayout>
			<Container mx="auto" size="sm">
				<BoxLayout>
					<Devnet />
				</BoxLayout>
			</Container>
		</AppLayout>
	);
}
