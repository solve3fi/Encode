import { useLingui } from "@lingui/react";
import {
	Button,
	Group,
	NumberFormatter,
	Paper,
	rem,
	Slider,
	Stack,
	Text,
} from "@mantine/core";
import { IconChevronLeft, IconChevronRight } from "@tabler/icons-react";
import {
	usePoolManager,
	usePoolManagerActions,
} from "@/stores/pool-manager/PoolManagaerProvider";

const PercentSteps = [25, 50, 75, 100];

export const ManagerRemovePercent: React.FC = () => {
	const removePercent = usePoolManager((state) => state.removePercent);
	const { setRemovePercent } = usePoolManagerActions();
	const { i18n } = useLingui();
	return (
		<Paper p="md" shadow="sm">
			<Stack gap={32}>
				<Group justify="space-between" wrap="nowrap">
					<Text fw={600} fz={rem(24)}>
						<NumberFormatter value={removePercent} suffix="%" />
					</Text>
					<Group gap={8} wrap="nowrap">
						{PercentSteps.map((percent) => (
							<Button
								key={percent}
								size="xs"
								variant="filled"
								bg={percent !== removePercent ? "gray.17" : undefined}
								onClick={() => setRemovePercent(percent)}
							>
								{percent === 100 ? i18n._("Max") : `${percent}%`}
							</Button>
						))}
					</Group>
				</Group>
				<Slider
					size="xs"
					color="purple.9"
					thumbSize={30}
					value={removePercent}
					min={0}
					max={100}
					step={1}
					onChangeEnd={(value) => setRemovePercent(value)}
					styles={{
						thumb: {
							borderRadius: 4,
							background: "var(--mantine-color-gray-0)",
						},
					}}
					thumbChildren={
						<>
							<IconChevronLeft />
							<IconChevronRight />
						</>
					}
				/>
			</Stack>
		</Paper>
	);
};
