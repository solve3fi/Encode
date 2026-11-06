import { IconArrowsUpDown } from "@tabler/icons-react";
import { useSwapActions } from "@/stores/swap/SwapProvider";
import classes from "./Swap.module.css";

export const SwitchTokens: React.FC = () => {
	const { switchToken } = useSwapActions();

	return (
		<div className={classes.flipWrap}>
			<button
				type="button"
				className={classes.flip}
				onClick={switchToken}
				aria-label="Switch tokens"
			>
				<IconArrowsUpDown size={20} stroke={2.2} />
			</button>
		</div>
	);
};
