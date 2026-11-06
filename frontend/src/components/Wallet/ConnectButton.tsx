import { useLingui } from "@lingui/react";
import { ModalType } from "@/stores/modal";
import { useModalActions } from "@/stores/modal/ModalProvider";
import classes from "./Wallet.module.css";

export const ConnectButton: React.FC = () => {
	const { i18n } = useLingui();
	const { setOpenModal } = useModalActions();

	return (
		<button
			type="button"
			className={classes.connect}
			onClick={() => setOpenModal(ModalType.WALLET)}
		>
			{i18n._("Connect wallet")}
		</button>
	);
};
