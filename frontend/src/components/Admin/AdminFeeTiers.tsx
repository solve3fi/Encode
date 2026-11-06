import { useLingui } from "@lingui/react";
import { Button, Group, Stack, Text } from "@mantine/core";
import { useEnabledFeeTiers } from "@/hooks/useEnabledFeeTiers";
import { useInitializeFeeTier } from "@/stores/admin/hooks/useInitializeFeeTier";
import { FeeAmount, TICK_SPACINGS } from "@/stores/pool";
import { CardLayout } from "../Layout/CardLayout";

const TIERS = (Object.values(FeeAmount).filter(
	(value): value is number => typeof value === "number",
) as number[]).sort((a, b) => a - b);

export const AdminFeeTiers: React.FC = () => {
	const { i18n } = useLingui();
	const { data: enabled, isLoading } = useEnabledFeeTiers();
	const { mutate: initialize, isPending, variables } = useInitializeFeeTier();

	return (
		<CardLayout>
			<Stack gap="md">
				<Text fz="lg" fw="bold">
					{i18n._("Fee Tiers")}
				</Text>
				<Text fz="sm" c="gray">
					{i18n._(
						"A pool can only be created on a fee tier that exists on-chain. Enabling a tier is signed by the DEX fee-authority wallet and costs a small account rent.",
					)}
				</Text>
				<Stack gap="xs">
					{TIERS.map((fee) => {
						const spacing = TICK_SPACINGS[fee as FeeAmount];
						const isEnabled = Boolean(enabled?.has(spacing));
						const busy = isPending && variables?.tickSpacing === spacing;
						return (
							<Group key={fee} justify="space-between" wrap="nowrap">
								<Text fw={600}>{fee / 10_000}%</Text>
								<Text c="gray" fz="sm">
									{i18n._("Tick spacing {spacing}", { spacing })}
								</Text>
								{isEnabled ? (
									<Text c="teal" fz="sm" fw={600}>
										{i18n._("Enabled")}
									</Text>
								) : (
									<Button
										size="xs"
										variant="light"
										loading={busy}
										disabled={isLoading || isPending}
										onClick={() =>
											initialize({ tickSpacing: spacing, defaultFeeRate: fee })
										}
									>
										{i18n._("Enable")}
									</Button>
								)}
							</Group>
						);
					})}
				</Stack>
			</Stack>
		</CardLayout>
	);
};
