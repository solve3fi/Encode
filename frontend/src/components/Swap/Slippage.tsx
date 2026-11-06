import { useLingui } from "@lingui/react";
import { IconSettings } from "@tabler/icons-react";
import { DEFAULT_SLIPPAGE, SLIPPAGES } from "@/stores/application";
import {
	useApplication,
	useApplicationActions,
} from "@/stores/application/ApplicationProvider";
import { ModalType } from "@/stores/modal";
import { useModalActions } from "@/stores/modal/ModalProvider";
import classes from "./Swap.module.css";

export const SlippageToggle: React.FC<{
	open: boolean;
	onToggle: () => void;
}> = ({ open, onToggle }) => (
	<button
		type="button"
		className={classes.iconBtn}
		aria-label="Slippage settings"
		aria-expanded={open}
		onClick={onToggle}
	>
		<IconSettings size={18} stroke={2} />
	</button>
);

/** Inline max-slippage chips. Custom values and the deadline live in the settings modal. */
export const SlippagePanel: React.FC = () => {
	const { i18n } = useLingui();
	const { setOpenModal } = useModalActions();
	const { setSlippage } = useApplicationActions();
	const slippage = useApplication((state) => state.slippage);
	const current = slippage === "auto" ? DEFAULT_SLIPPAGE : slippage;

	return (
		<div className={classes.settings}>
			<span className={classes.eyebrow}>{i18n._("Max slippage")}</span>
			<div className={classes.chips}>
				{SLIPPAGES.map((value) => (
					<button
						key={value}
						type="button"
						className={classes.chip}
						aria-pressed={current === value}
						onClick={() => setSlippage(value)}
					>
						{value.toFixed(2)}%
					</button>
				))}
				<button
					type="button"
					className={classes.linkBtn}
					onClick={() => setOpenModal(ModalType.SLIPPAGE)}
				>
					{i18n._("Custom & deadline")}
				</button>
			</div>
		</div>
	);
};
