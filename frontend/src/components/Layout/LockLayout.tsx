import { useLingui } from "@lingui/react";
import { Button, Center, Grid, Group, Stack, Text, Title } from "@mantine/core";
import { IconChevronLeft } from "@tabler/icons-react";
import Link from "next/link";
import { CardLayout } from "./CardLayout";

export type LockLayoutProps = {
	left: React.ReactNode;
	right: React.ReactNode;
	leftTitle?: string;
	rightTitle?: string;
};

export const LockLayout: React.FC<LockLayoutProps> = ({
	left,
	right,
	leftTitle,
	rightTitle,
}) => {
	const { i18n } = useLingui();
	return (
		<Grid
			gutter={{ base: 5, xs: "md", md: "xl", xl: 30 }}
			py={{
				base: 20,
				md: 80,
			}}
		>
			<Grid.Col
				span={{
					base: 12,
					lg: 6.5,
				}}
			>
				<Center maw={{ base: 600, lg: 800 }} w="100%" mx="auto">
					<CardLayout w="100%">
						<Stack gap="md">
							<Group align="center" justify="space-between">
								<Title fs="xl">{leftTitle}</Title>
								<Button
									variant="light"
									c="gray"
									component={Link}
									href={"/lock"}
									leftSection={
										<IconChevronLeft color="var(--mantine-color-gray-8)" />
									}
								>
									{i18n._("Back to Locks")}
								</Button>
							</Group>
							{left}
						</Stack>
					</CardLayout>
				</Center>
			</Grid.Col>

			<Grid.Col
				span={{
					base: 12,
					lg: 5.5,
				}}
			>
				<Center
					maw={{
						base: 600,
						lg: 800,
					}}
					w="100%"
					mx="auto"
				>
					<CardLayout w="100%">
						<Stack gap="md">
							<Text fz="lg" fw="bold" tt="capitalize">
								{rightTitle}
							</Text>
							{right}
						</Stack>
					</CardLayout>
				</Center>
			</Grid.Col>
		</Grid>
	);
};
