import type { TokenInfo } from "@solana/spl-token-registry";
import type Decimal from "decimal.js";
import { type Field, PoolTypes } from "@/stores/pool";
import { usePool } from "@/stores/pool/PoolProvider";
import { PoolAmountPanel } from "./PoolAmountPanel";
import { PoolFeeTier } from "./PoolFeeTier";

export type PoolFeeProps = {
	baseCurrency?: TokenInfo | null;
	quoteCurrency?: TokenInfo | null;
	parsedAmounts?: { [field in Field]?: Decimal };
	price: Decimal | undefined;
	invertPrice: boolean;
};

export const PoolFee: React.FC<PoolFeeProps> = ({
	baseCurrency,
	quoteCurrency,
	parsedAmounts,
	price,
	invertPrice,
}) => {
	const poolType = usePool((state) => state.poolType);

	return poolType === PoolTypes.AUTOMATIC ? (
		<>
			{/* <PoolALM /> */}
			<PoolAmountPanel
				currencyA={baseCurrency}
				currencyB={quoteCurrency}
				parsedAmounts={parsedAmounts}
			/>
			{/* <PoolHandlePosition data={data} /> */}
		</>
	) : (
		<PoolFeeTier
			currencyA={baseCurrency}
			currencyB={quoteCurrency}
			price={price}
			invertPrice={invertPrice}
		/>
	);
};
