import { useLingui } from "@lingui/react";
import { Button, Group, rem, Stack, Text } from "@mantine/core";
import { useCountdown } from "@/hooks/useCountdown";
import { PreSaleTimer } from "./PreSaleTimer";

export const PreSaleCountdown: React.FC = () => {
	const { i18n } = useLingui();
	const COUNTDOWN_DATE = new Date("2025-08-20T09:29:59Z").getTime();
	const { days, hours, minutes, seconds } = useCountdown(COUNTDOWN_DATE);
	return (
		<Stack>
			<Group justify="space-between">
				<Text fz={rem(20)} fw={600}>
					{i18n._("End in")}
				</Text>
				<Text fz={rem(18)} fw={600} c="purple.5">
					{i18n._("Feb 15th 2023 00:00 UTC")}
				</Text>
			</Group>

			<PreSaleTimer
				days={days}
				hours={hours}
				minutes={minutes}
				seconds={seconds}
			/>

			<Button fullWidth size="lg">
				{i18n._("Deposit SOL")}
			</Button>
		</Stack>
	);
};
