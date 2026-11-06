import { useLingui } from "@lingui/react";
import { Button } from "@mantine/core";
import classes from "./BridgeButton.module.css";
export const BridgeSwapButton: React.FC = () => {
	const { i18n } = useLingui();
	return (
		<Button
			h={48}
			tt="capitalize"
			fz="md"
			fw={600}
			radius="sm"
			classNames={classes}
		>
			{i18n._("Swap")}
		</Button>
	);
};
