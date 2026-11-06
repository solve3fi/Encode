import { Avatar, Button, type ButtonProps } from "@mantine/core";
import type { TokenInfo } from "@solana/spl-token-registry";
import { IconChevronDown } from "@tabler/icons-react";

import { ModalType } from "@/stores/modal";
import { useModalActions } from "@/stores/modal/ModalProvider";
import type { Field } from "@/stores/pool";
import classes from "./PoolCurrency.module.css";

export type PoolCurrencyProps = ButtonProps & {
	token?: TokenInfo | null;
	method: Field;
};

export const PoolCurrency: React.FC<PoolCurrencyProps> = ({
	token,
	method,
}) => {
	const { setOpenModal } = useModalActions();

	return (
		<Button
			leftSection={<Avatar src={token?.logoURI} size={24} />}
			rightSection={<IconChevronDown />}
			onClick={() => setOpenModal(ModalType.TOKENS, { method })}
			color="gray"
			variant="light"
			justify="space-between"
			classNames={classes}
			size="md"
		>
			{token?.symbol}
		</Button>
	);
};
