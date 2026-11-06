import { useLingui } from "@lingui/react";
import {
	Avatar,
	Button,
	Card,
	Group,
	NumberFormatter,
	Stack,
	Text,
} from "@mantine/core";
import { WalletConnect } from "../Wallet";
import classes from "./BridgeButton.module.css";
import { BridgeCurrency } from "./BridgeCurrency";

export const BridgeAmountIn: React.FC = () => {
	const { i18n } = useLingui();
	return (
		<Card bg="dark.10">
			<Group>
				<Card w={160} bg="dark.10">
					<Stack gap={12} mx="auto">
						<Text fz="sm" fw={600} c="gray">
							{i18n._("Network")}
						</Text>
						<Avatar src="/assets/tokens/eth.png" size={64} alt="eth" />
						<Text fz="sm" fw={600} c="gray">
							{i18n._("Ethereum")}
						</Text>
					</Stack>
				</Card>

				<Stack style={{ flexGrow: 1 }} gap={10}>
					<Group justify="space-between">
						<Text tt="uppercase" fw="bold">
							{i18n._("From")}
						</Text>
						<WalletConnect />
					</Group>
					<BridgeCurrency />
					<Group justify="space-between">
						<Text fz="sm" fw="bold" c="gray">
							{i18n._("Amount")}
						</Text>
						<Text fz="xl" fw="bold">
							<NumberFormatter
								value={2.1223}
								decimalScale={4}
								decimalSeparator="."
								thousandSeparator=","
							/>
						</Text>
					</Group>
					<Group justify="space-between">
						<Text fz="sm" fw="bold" c="gray">
							{i18n._("Balance")}
						</Text>
						<Group gap={8}>
							<Text fz="sm" fw="bold" c="gray">
								<NumberFormatter
									value={18.7685}
									decimalScale={4}
									decimalSeparator="."
									thousandSeparator=","
								/>
							</Text>
							<Button
								size="xs"
								w={44}
								h={24}
								p={0}
								tt="uppercase"
								c="gray"
								classNames={classes}
							>
								{i18n._("Max")}
							</Button>
						</Group>
					</Group>
				</Stack>
			</Group>
		</Card>
	);
};
