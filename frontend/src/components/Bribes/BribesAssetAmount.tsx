import {
	Avatar,
	Button,
	Group,
	NumberInput,
	Paper,
	Stack,
	Text,
} from "@mantine/core";
import type { TokenInfo } from "@solana/spl-token-registry";
import { IconChevronDown } from "@tabler/icons-react";
import { ModalType } from "@/stores/modal";
import { useModalActions } from "@/stores/modal/ModalProvider";
import { FundShortfall } from "../Fund/FundShortfall";
import { CurrencyBalance } from "../Token/CurrencyBalance";
import { TokenBalance } from "../Token/TokenBalance";
import classes from "./BribesAssetAmount.module.css";

export type BribesAssetAmountProps = {
	onSetAmount: (value: number) => void;
	amountIn: number;
	token: TokenInfo;
};

export const BribesAssetAmount: React.FC<BribesAssetAmountProps> = ({
	amountIn,
	token,
	onSetAmount,
}) => {
	const { setOpenModal } = useModalActions();
	return (
		<Paper p="md" shadow="sm" bg="dark.10">
			<Stack gap={0}>
				<Group align="center" justify="space-between" className={classes.amountRow}>
					<NumberInput
						size="lg"
						placeholder="0.00"
						hideControls
						fw="bold"
						value={amountIn || ""}
						aria-label="Incentive amount"
						allowNegative={false}
						allowLeadingZeros={false}
						min={0}
						className={classes.amountField}
						onChange={(value) => onSetAmount(Number(value))}
						classNames={{
							input: classes.amountinput,
						}}
						thousandSeparator=","
						decimalSeparator="."
					/>
					<Button
						variant="light"
						className={classes.tokenButton}
						aria-label="Select incentive token"
						radius="lg"
						onClick={() => setOpenModal(ModalType.TOKENS)}
						rightSection={<IconChevronDown />}
					>
						<Avatar
							size={24}
							src={token.logoURI}
							alt={token.symbol}
							radius="lg"
						/>
						<Text fz="lg" fw="bold" mx={5}>
							{token.symbol}
						</Text>
					</Button>
				</Group>
				<CurrencyBalance currency={token}>
					{({ balance, loading }) => (
						<>
							<Group align="center" justify="flex-end" gap={10}>
								<Text fz="sm" c="gray">
									<TokenBalance balance={balance} loading={loading} />
								</Text>
								<Button
									size="sm"
									mih={44}
									color="purple.9"
									tt="uppercase"
									onClick={() => onSetAmount(Number(balance))}
								>
									Max
								</Button>
							</Group>
							<FundShortfall symbol={token.symbol} amount={amountIn} balance={Number(balance)} loading={loading} />
						</>
					)}
				</CurrencyBalance>
			</Stack>
		</Paper>
	);
};
