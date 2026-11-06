import { Avatar } from "@mantine/core";
import type { TokenInfo } from "@solana/spl-token-registry";
import { IconChevronDown } from "@tabler/icons-react";
import { useCallback } from "react";
import { ModalType } from "@/stores/modal";
import { useModalActions } from "@/stores/modal/ModalProvider";
import classes from "./Swap.module.css";

export type MethodType = "from" | "to";

export type SwapCurrencyProps = {
	token: TokenInfo | null;
	method: MethodType;
};

export const SwapCurrency: React.FC<SwapCurrencyProps> = ({
	token,
	method,
}) => {
	const { setOpenModal } = useModalActions();

	const handleAsset = useCallback(() => {
		setOpenModal(ModalType.TOKENS, method);
	}, [method, setOpenModal]);

	return (
		<button type="button" className={classes.token} onClick={handleAsset}>
			<Avatar src={token?.logoURI} size={28} />
			{token?.symbol ?? "Select"}
			<IconChevronDown size={16} stroke={2.2} color="#A6A4B8" />
		</button>
	);
};
