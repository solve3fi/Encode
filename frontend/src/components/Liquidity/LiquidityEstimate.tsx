import { useLingui } from "@lingui/react";
import { Flex, Group, Paper, rem, Text } from "@mantine/core";
import { IconClockPlay } from "@tabler/icons-react";
import { useCountdown } from "@/hooks/useCountdown";

const EXPIRATION_DATE = new Date("2024-04-04T09:29:59Z").getTime();

export const LiquidityEstimate: React.FC = () => {
	const { i18n } = useLingui();

	const THREE_HOURS_IN_MS = 3 * 60 * 60 * 1000;
	const { hours, minutes } = useCountdown(THREE_HOURS_IN_MS + EXPIRATION_DATE);
	return (
		<Paper
			radius="sm"
			p={10}
			withBorder
			bg="purple.17"
			style={{
				borderWidth: rem(2),
				borderColor: "var(--mantine-color-purple-6)",
			}}
		>
			<Flex
				align="center"
				gap={5}
				direction={{
					base: "column",
					sm: "row",
				}}
				ta="center"
			>
				<Group gap={5}>
					<IconClockPlay size={20} color="white" />
					<Text c="purple.6" fw="bold" size="lg">
						<Text span inherit>{`${hours}h`}</Text>{" "}
						<Text span inherit>{`${minutes}m`}</Text>
					</Text>
				</Group>
				<Text fw="bold" fz="sm">
					{i18n._("Since last xSOLV3 distribution")}
				</Text>
			</Flex>
		</Paper>
	);
};
