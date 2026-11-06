import { useLingui } from "@lingui/react";
import { Button, Group, Text } from "@mantine/core";
import type { TokenInfo } from "@solana/spl-token-registry";
import type BN from "bn.js";
import type Decimal from "decimal.js";
import type { Field } from "@/stores/pool";
import { usePoolActions } from "@/stores/pool/PoolProvider";
import { CurrencyBalance } from "../Token/CurrencyBalance";
import { TokenBalance } from "../Token/TokenBalance";

const BalanceCustom: React.FC<{
	balance?: number | BN;
	loading: boolean;
	handleAssetAmount: (value: number) => void;
}> = ({ balance, loading, handleAssetAmount }) => {
	const { i18n } = useLingui();
	return (
		<Group gap={10}>
			<Text size="sm" c="gray">
				<TokenBalance balance={balance} loading={loading} />
			</Text>
			<Button
				size="xxs"
				color="purple.9"
				onClick={() => handleAssetAmount(Number(balance))}
				tt="uppercase"
			>
				{i18n._("Max")}
			</Button>
		</Group>
	);
};

export type PoolTokenBalanceProps = {
	currency?: TokenInfo | null;
	method: Field;
	value?: Decimal;
};

export const PoolTokenBalance: React.FC<PoolTokenBalanceProps> = ({
	currency,
	method,
}) => {
	const { i18n } = useLingui();
	const { setTypedValue, setIndependentField } = usePoolActions();

	const handleChangeAmount = (value: string | number) => {
		setTypedValue(Number.parseFloat(value.toString()));
		setIndependentField(method);
	};

	return (
		<Group align="center" justify="space-between" gap={5}>
			<Text c="gray" size="sm">
				{i18n._("Balance:")}
			</Text>
			<CurrencyBalance currency={currency}>
				{({ balance, loading }) => (
					<BalanceCustom
						balance={balance}
						loading={loading}
						handleAssetAmount={handleChangeAmount}
					/>
				)}
			</CurrencyBalance>
		</Group>
	);
};
