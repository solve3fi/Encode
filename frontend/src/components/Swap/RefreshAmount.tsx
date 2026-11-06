import { IconRefresh } from "@tabler/icons-react";
import { useIsFetching, useQueryClient } from "@tanstack/react-query";
import classes from "./Swap.module.css";

/** Re-requests the best route quote on demand. */
export const RefreshAmount: React.FC = () => {
	const queryClient = useQueryClient();
	const fetching = useIsFetching({ queryKey: ["bestTrade"] }) > 0;
	return (
		<button
			type="button"
			className={`${classes.iconBtn} ${fetching ? classes.spin : ""}`}
			aria-label="Refresh quote"
			onClick={() => queryClient.invalidateQueries({ queryKey: ["bestTrade"] })}
		>
			<IconRefresh size={18} stroke={2} />
		</button>
	);
};
