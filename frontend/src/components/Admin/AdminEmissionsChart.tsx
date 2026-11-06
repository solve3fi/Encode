import { useLingui } from "@lingui/react";
import { BarChart } from "@mantine/charts";
import "@mantine/charts/styles.css";
import { Center, Stack, Text } from "@mantine/core";
import { useEmissionsHistory } from "@/stores/admin/hooks/useEmissionsHistory";
import { CardLayout } from "../Layout/CardLayout";

export const AdminEmissionsChart: React.FC = () => {
	const { i18n } = useLingui();
	const { data, isLoading } = useEmissionsHistory();

	const chartData = (data ?? []).map((point) => ({
		epoch: `${i18n._("Epoch")} ${point.epoch}`,
		emissions: point.emissions,
	}));

	return (
		<CardLayout>
			<Stack gap="md">
				<Text fz="lg" fw="bold">
					{i18n._("Emissions Distributed per Epoch")}
				</Text>
				{!isLoading && chartData.length === 0 ? (
					<Center h={200}>
						<Text c="gray" fz="sm">
							{i18n._(
								"No emissions have been distributed yet — this fills in after distribute_reward is called for an epoch.",
							)}
						</Text>
					</Center>
				) : (
					<BarChart
						h={300}
						data={chartData}
						dataKey="epoch"
						series={[
							{
								name: "emissions",
								label: i18n._("Emissions"),
								color: "purple.6",
							},
						]}
						tickLine="y"
						gridAxis="y"
						withLegend={false}
					/>
				)}
			</Stack>
		</CardLayout>
	);
};
