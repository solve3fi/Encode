import { useLingui } from "@lingui/react";
import {
	Avatar,
	Group,
	NumberFormatter,
	rem,
	Select,
	Stack,
	Text,
} from "@mantine/core";
import { IconChevronDown } from "@tabler/icons-react";
import classes from "./PreSaleRightDetail.module.css";

export const PreSaleRightDetail: React.FC = () => {
	const { i18n } = useLingui();
	return (
		<Stack>
			<Stack gap={4}>
				<Group justify="space-between">
					<Text fw={600}>{i18n._("Token allocation")}</Text>
					<Text fw={600} c="purple.5">
						<NumberFormatter
							decimalSeparator="."
							thousandSeparator=","
							value={50.25}
						/>
						{i18n._(" veSOLV3")}
					</Text>
				</Group>
				<Group justify="space-between">
					<Text fw={600}>{i18n._("Allocation %")}</Text>
					<Text fw={600} c="purple.5">
						<NumberFormatter
							decimalSeparator="."
							thousandSeparator=","
							value={85.25}
							suffix="%"
						/>
					</Text>
				</Group>
				<Group justify="space-between">
					<Text fw={600}>{i18n._("Amount paid")}</Text>
					<Group gap={4}>
						<Text fw={600} c="purple.5">
							<NumberFormatter
								decimalSeparator="."
								thousandSeparator=","
								value={10.25}
							/>
						</Text>
						<Avatar size={rem(24)} src="/assets/tokens/solv3.png" />
					</Group>
				</Group>
			</Stack>

			<Select
				variant="filled"
				size="lg"
				data={["1", "2", "3"]}
				placeholder={i18n._("Launchpad Duration")}
				rightSection={<IconChevronDown size={20} />}
				classNames={classes}
			/>

			<Stack gap={4}>
				<Group justify="space-between">
					<Text fw={600} c="purple.5">
						{i18n._("Funds to raise")}
					</Text>
					<Text fw={600} c="purple.5">
						{i18n._("Launchpad ends at")}
					</Text>
				</Group>
				<Group justify="space-between">
					<Text fw={600}>{i18n._("Wed,15 Fed 2023")}</Text>
					<Text fw={600}>{i18n._("Wed,15 Fed 2023")}</Text>
				</Group>
				<Group justify="space-between">
					<Text fw={600}>{i18n._("08:30:00 GMT")}</Text>
					<Text fw={600}>{i18n._("08:30:00 GMT")}</Text>
				</Group>
			</Stack>
		</Stack>
	);
};
