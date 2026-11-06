import { useLingui } from "@lingui/react";
import { SegmentedControl, Stack } from "@mantine/core";
import type { TokenInfo } from "@solana/spl-token-registry";
import type { IncreaseLiquidityQuote, Position, Solve } from "@solve3fi/sdk";
import type Decimal from "decimal.js";
import { type ReactNode, useState } from "react";
import { CardLayout } from "@/components/Layout/CardLayout";
import type { Field } from "@/stores/pool";
import { ManagerAddPanel } from "./ManagerAddPanel";
import { ManagerRemovePanel } from "./ManagerRemovePanel";
import { ManagerTransferPanel } from "./ManagerTransferPanel";

export enum ActionMethod {
	ADD = "add",
	REMOVE = "remove",
	TRANSFER = "transfer",
}

export type ManagerActionProps = {
	position: Position;
	pool: Solve | null;
	baseCurrency?: TokenInfo | null;
	quoteCurrency?: TokenInfo | null;
	parsedAmounts: { [field in Field]?: Decimal | undefined };
	outOfRange: boolean;
	noLiquidity: boolean;
	errorMessage: ReactNode | undefined;
	quote?: IncreaseLiquidityQuote;
	tickLower?: number;
	tickUpper?: number;
	tickCurrentIndex?: number;
};

export const ManagerAction: React.FC<ManagerActionProps> = ({
	pool,
	baseCurrency,
	quoteCurrency,
	parsedAmounts,
	outOfRange,
	noLiquidity,
	errorMessage,
	quote,
	tickLower,
	tickUpper,
	tickCurrentIndex,
	position,
}) => {
	const { i18n } = useLingui();
	const [value, setValue] = useState<ActionMethod>(ActionMethod.ADD);
	return (
		<CardLayout w="100%">
			<Stack gap="md">
				<SegmentedControl
					value={value}
					onChange={(value) => setValue(value as ActionMethod)}
					bg="gray.19"
					color="gray.17"
					size="lg"
					flex={1}
					data={[
						{ label: i18n._("Add"), value: ActionMethod.ADD },
						{ label: i18n._("Remove"), value: ActionMethod.REMOVE },
						// { label: i18n._("Transfer"), value: ActionMethod.TRANSFER },
					]}
				/>
				{value === ActionMethod.ADD && (
					<ManagerAddPanel
						pool={pool}
						position={position}
						baseCurrency={baseCurrency}
						quoteCurrency={quoteCurrency}
						parsedAmounts={parsedAmounts}
						outOfRange={outOfRange}
						noLiquidity={noLiquidity}
						errorMessage={errorMessage}
						quote={quote}
						tickLower={tickLower}
						tickUpper={tickUpper}
						tickCurrentIndex={tickCurrentIndex}
					/>
				)}

				{value === ActionMethod.REMOVE && (
					<ManagerRemovePanel
						position={position}
						pool={pool}
						outOfRange={outOfRange}
					/>
				)}

				{value === ActionMethod.TRANSFER && (
					<ManagerTransferPanel position={position} />
				)}
			</Stack>
		</CardLayout>
	);
};
