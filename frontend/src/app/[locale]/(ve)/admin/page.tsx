"use client";

import { Container } from "@mantine/core";
import { Admin } from "@/components/Admin";
import { AppLayout } from "@/components/Layout/AppLayout";
import { BoxLayout } from "@/components/Layout/BoxLayout";

export default function AdminPage() {
	return (
		<AppLayout>
			<Container mx="auto" size="xl">
				<BoxLayout>
					<Admin />
				</BoxLayout>
			</Container>
		</AppLayout>
	);
}
