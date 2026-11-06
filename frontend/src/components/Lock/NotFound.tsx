import { useLingui } from "@lingui/react";
import { Anchor, Center, Container, Group, Text, Title } from "@mantine/core";
import { IconChevronLeft } from "@tabler/icons-react";
import { CardLayout } from "@/components/Layout/CardLayout";

export const NotFound: React.FC = () => {
	const { i18n } = useLingui();
	return (
		<Container mx="auto" size="xl">
			<Center
				py={{
					base: 20,
					md: 80,
				}}
			>
				<CardLayout maw={590} w="100%">
					<Title fs="xl">{i18n._("Not Found")}</Title>
					<Text>{i18n._("The lock you are looking for does not exist.")}</Text>
					<Anchor href="/lock">
						<Group gap={2}>
							<IconChevronLeft />
							{i18n._("Back to locks")}
						</Group>
					</Anchor>
				</CardLayout>
			</Center>
		</Container>
	);
};
