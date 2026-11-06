import { ActionIcon, Group } from "@mantine/core";
import { DecimalUtil } from "@solve3fi/common";
import { PriceMath } from "@solve3fi/sdk";
import { IconSwitchHorizontal } from "@tabler/icons-react";
import type Decimal from "decimal.js";
import { useCallback } from "react";
import { useToken } from "@/hooks/useToken";
import { Field } from "@/stores/pool";
import { usePool, usePoolActions } from "@/stores/pool/PoolProvider";
import { PoolAssetModal } from "./PoolAssetModal";
import { PoolCurrency } from "./PoolCurrency";

export type PoolAssetPanelProps = {
	priceLower: Decimal | undefined;
	priceUpper: Decimal | undefined;
	invertPrice: boolean;
};

export const PoolAssetPanel: React.FC<PoolAssetPanelProps> = ({
	priceLower,
	priceUpper,
	invertPrice,
}) => {
	const currencyA = usePool((state) => state.currencyA);
	const currencyB = usePool((state) => state.currencyB);
	const range = usePool((state) => state.range);

	const baseCurrency = useToken(currencyA.toString());
	const quoteCurrency = useToken(currencyB.toString());

	const { switchToken, setLowerPrice, setUpperPrice } = usePoolActions();
	const handleSwitchToken = useCallback(() => {
		switchToken();

		if (range.demission === null) {
			setLowerPrice(true);
			setUpperPrice(true);
			return;
		}
		try {
			setLowerPrice(
				Number(
					(invertPrice
						? priceLower
						: PriceMath.invertPrice(
								priceUpper ?? DecimalUtil.fromNumber(0),
								baseCurrency?.decimals ?? 8,
								quoteCurrency?.decimals ?? 8,
							)
					)?.toNumber(),
				),
			);
			setUpperPrice(
				Number(
					(invertPrice
						? priceUpper
						: PriceMath.invertPrice(
								priceLower ?? DecimalUtil.fromNumber(0),
								baseCurrency?.decimals ?? 8,
								quoteCurrency?.decimals ?? 8,
							)
					)?.toNumber(),
				),
			);
		} catch (error) {
			console.log(error);
		}
	}, [
		invertPrice,
		priceLower,
		priceUpper,
		switchToken,
		setLowerPrice,
		setUpperPrice,
		baseCurrency?.decimals,
		quoteCurrency?.decimals,
		range,
	]);

	return (
		<Group align="center" justify="space-between" gap={10}>
			<PoolCurrency token={baseCurrency} method={Field.CURRENCY_A} />
			<ActionIcon
				variant="transparent"
				size="input-md"
				onClick={handleSwitchToken}
			>
				<IconSwitchHorizontal />
			</ActionIcon>
			<PoolCurrency token={quoteCurrency} method={Field.CURRENCY_B} />
			<PoolAssetModal />
		</Group>
	);
};
