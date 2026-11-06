import { useLingui } from "@lingui/react";
import {
	Avatar,
	Badge,
	Flex,
	Group,
	NumberFormatter,
	Stack,
	Text,
} from "@mantine/core";
import { Percentage } from "@solve3fi/common";
import type { TokenInfo } from "@solana/spl-token-registry";
import { CurrencyLogo } from "@/components/Token/CurrencyLogo";

export type ManagerStatusProps = {
	currencyA?: TokenInfo | null;
	currencyB?: TokenInfo | null;
	feeAmount?: number;
	removed?: boolean;
	outOfRange?: boolean;
};

export const ManagerStatus: React.FC<ManagerStatusProps> = ({
	currencyA,
	currencyB,
	feeAmount,
	removed,
	outOfRange,
}) => {
	const { i18n } = useLingui();
	return (
		<Stack>
			<Flex
				justify="space-between"
				gap={8}
				direction={{ base: "column", lg: "row" }}
			>
				<Group gap={10}>
					<Avatar.Group>
						<CurrencyLogo currency={currencyA} size={32} />
						<CurrencyLogo currency={currencyB} size={32} />
					</Avatar.Group>
					<Text fw="bold" tt="uppercase">
						{currencyA?.symbol}/{currencyB?.symbol}
					</Text>
				</Group>

				<Group gap={8}>
					<Badge color="gray.17" variant="filled" radius="xs" size="md">
						<Text fz="xs" tt="capitalize">
							{i18n._("Manual")}
						</Text>
					</Badge>
					<Badge color="gray.17" variant="filled" radius="xs" size="md">
						<Text fz="xs" tt="capitalize">
							<NumberFormatter
								value={Percentage.fromFraction(feeAmount ?? 0, 10000)
									.toDecimal()
									.toString()}
								decimalScale={2}
								suffix="%"
							/>
						</Text>
					</Badge>
					{removed ? (
						<Badge
							variant="outline"
							radius="sm"
							color="error.8"
							p={10}
							tt="capitalize"
						>
							{i18n._("Removed")}
						</Badge>
					) : outOfRange ? (
						<Badge
							variant="outline"
							radius="sm"
							color="error.5"
							p={10}
							tt="capitalize"
						>
							{i18n._("Out of Range")}
						</Badge>
					) : (
						<Badge
							variant="outline"
							radius="sm"
							color="success.5"
							p={10}
							tt="capitalize"
						>
							{i18n._("In Range")}
						</Badge>
					)}
				</Group>
			</Flex>
		</Stack>
	);
};
