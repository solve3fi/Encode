import { useLingui } from "@lingui/react";
import { Button, Group } from "@mantine/core";
import type { Address } from "@solve3fi/common";
import type React from "react";
import { useCollectPositionFee } from "@/hooks/useCollectPositionFee";
import { usePositionInfo } from "@/hooks/usePositionInfo";

export type RewardHandleCollectFeeProps = {
	postionId: Address;
	/** Card layout (RewardListsMobile) wants the claim to span the card;
	 * the desktop table keeps it right-aligned in its own column. */
	fullWidth?: boolean;
};

export const RewardHandleCollectFee: React.FC<RewardHandleCollectFeeProps> = ({
	postionId,
	fullWidth = false,
}) => {
	const { i18n } = useLingui();
	const { data: position } = usePositionInfo(postionId);
	const { mutate, isPending } = useCollectPositionFee();
	const button = (
		<Button
			size={fullWidth ? "md" : "lg"}
			fullWidth={fullWidth}
			variant="filled"
			loading={isPending}
			onClick={() => mutate({ position })}
		>
			{i18n._("Claim")}
		</Button>
	);
	if (fullWidth) return button;
	return (
		<Group gap={10} justify="flex-end">
			{button}
		</Group>
	);
};
