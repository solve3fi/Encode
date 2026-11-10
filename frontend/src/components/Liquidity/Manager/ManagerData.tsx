import { Center, Grid } from "@mantine/core";
import { AddressUtil } from "@solve3fi/common";
import type { Position, Solve } from "@solve3fi/sdk";
import { useDerivedMintInfo } from "@/hooks/useDerivedMintInfo";
import { useToken } from "@/hooks/useToken";
import { usePoolManager } from "@/stores/pool-manager/PoolManagaerProvider";
import { ArenaPairCard } from "@/components/V2/ArenaPairCard";
import { ManagerAction } from "./ManagerAction";
import { ManagerPosition } from "./ManagerPosition";

export type ManagerDataProps = {
	position: Position;
	pool: Solve;
};

export const ManagerData: React.FC<ManagerDataProps> = ({ position, pool }) => {
	const sorted = usePoolManager((state) => state.sorted);

	const token0Address = position.getSolveData().tokenMintA.toString();
	const token1Address = position.getSolveData().tokenMintB.toString();

	const feeTier = position.getSolveData().feeRate;
	const tickLower = position.getData().tickLowerIndex;
	const tickUpper = position.getData().tickUpperIndex;

	const token0 = sorted ? token1Address : token0Address;
	const token1 = sorted ? token0Address : token1Address;

	const baseCurrency = useToken(token0);
	const baseBCurrency = useToken(token1);
	const quoteCurrency =
		baseCurrency &&
		baseBCurrency &&
		AddressUtil.toPubKey(baseCurrency.address).equals(
			AddressUtil.toPubKey(baseBCurrency.address),
		)
			? undefined
			: baseBCurrency;

	const {
		parsedAmounts,
		noLiquidity,
		errorMessage,
		outOfRange,
		quote,
	} = useDerivedMintInfo(
		baseCurrency ?? undefined,
		quoteCurrency ?? undefined,
		feeTier,
		baseCurrency ?? undefined,
		position,
	);

	return (
		<>
		<div style={{ maxWidth: 640, margin: "0 auto 8px" }}>
			<ArenaPairCard mintA={token0Address} mintB={token1Address} feeRate={feeTier} heading="THIS POOL IN THE ARENA" />
		</div>
		<Grid
			gutter={{ base: 5, xs: "md", md: "xl", xl: 30 }}
			py={{
				base: 12,
				md: 24,
			}}
		>
			<Grid.Col
				span={{
					base: 12,
					lg: 6,
				}}
			>
				<Center maw={600} w="100%" mx="auto">
					<ManagerPosition
						position={position}
						feeAmount={feeTier}
						sorted={sorted}
						pool={pool}
					/>
				</Center>
			</Grid.Col>

			<Grid.Col
				span={{
					base: 12,
					lg: 6,
				}}
			>
				<Center
					maw={{
						base: 600,
						lg: 800,
					}}
					w="100%"
					mx="auto"
				>
					<ManagerAction
						pool={pool}
						position={position}
						baseCurrency={baseCurrency}
						quoteCurrency={quoteCurrency}
						parsedAmounts={parsedAmounts}
						outOfRange={outOfRange}
						noLiquidity={noLiquidity}
						errorMessage={errorMessage}
						tickLower={tickLower}
						tickUpper={tickUpper}
						quote={quote}
					/>
				</Center>
			</Grid.Col>
		</Grid>
		</>
	);
};
