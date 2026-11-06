import { useLingui } from "@lingui/react";
import {
	Box,
	Card,
	Group,
	NumberFormatter,
	Paper,
	Stack,
	Text,
} from "@mantine/core";
import { IconArrowNarrowRight, IconRoute } from "@tabler/icons-react";
import { BridgeBadge } from "./BridgeBadge";

export const BridgeTradeRoute: React.FC = () => {
	const { i18n } = useLingui();
	return (
		<Stack>
			<Card bg="dark.10" radius="sm">
				<Group justify="space-between">
					<Group gap={8}>
						<IconRoute size={20} />
						<Text fw="bold" tt="uppercase">
							{i18n._("Trade route")}
						</Text>
					</Group>

					<Text fz="sm" fw="bold" c="gray.21">
						{i18n._("This route provide by Circle")}
					</Text>
				</Group>
			</Card>

			<Group justify="space-between">
				<Group gap={8}>
					<Text fz="sm" c="gray.21" fw="bold">
						{i18n._("Circle CCTPP")}
					</Text>
					<Paper px={20} py={4} radius="sm" bg="var(--color-e185281a)">
						<Text fz="sm" c="var(--color-e18528)">
							{i18n._("Approve transfer with destination wallet")}
						</Text>
					</Paper>
				</Group>

				<Text fw="bold" fz="xl">
					<NumberFormatter
						value={0.0}
						decimalScale={2}
						thousandSeparator=","
						decimalSeparator="."
						suffix=" USDT"
					/>
				</Text>
			</Group>

			<Group justify="space-between">
				<Group gap={0}>
					<BridgeBadge />
					<IconArrowNarrowRight size={24} />
					<BridgeBadge />
					<IconArrowNarrowRight size={24} />
					<BridgeBadge />
				</Group>
				<Box>
					<Text fz="sm" c="gray" ta="right">
						{i18n._("After fees")}
					</Text>
					<Text fz="sm" c="gray" ta="right">
						{i18n._("Estimated time: 16m 0s")}
					</Text>
				</Box>
			</Group>
		</Stack>
	);
};
