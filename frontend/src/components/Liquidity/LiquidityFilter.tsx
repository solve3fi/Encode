import { useLingui } from "@lingui/react";
import { IconSearch } from "@tabler/icons-react";
import { useSearchParams } from "next/navigation";
import { useEffect } from "react";
import {
	useLiquidity,
	useLiquidityActions,
} from "@/stores/liquidity/LiquidityProvider";
import classes from "./LiquidityControls.module.css";

export const LiquidityFilter: React.FC = () => {
	const { i18n } = useLingui();
	const filter = useLiquidity((state) => state.filter);
	const { setFilter } = useLiquidityActions();
	// The command bar opens Pools filtered to a pair (/liquidity?q=sol/usdc).
	const query = useSearchParams().get("q");
	useEffect(() => {
		if (query) setFilter(query);
	}, [query, setFilter]);
	return (
		<div className={classes.search}>
			<IconSearch size={20} stroke={1.8} aria-hidden="true" />
			<label
				htmlFor="pool-search"
				style={{ position: "absolute", left: -9999 }}
			>
				{i18n._("Search pools")}
			</label>
			<input
				id="pool-search"
				type="text"
				placeholder={i18n._("Search by token or pair")}
				value={filter}
				onChange={(event) => setFilter(event.currentTarget.value)}
			/>
			{filter && (
				<button
					type="button"
					className={classes.clear}
					onClick={() => setFilter("")}
					aria-label={i18n._("Clear search")}
				>
					×
				</button>
			)}
		</div>
	);
};
