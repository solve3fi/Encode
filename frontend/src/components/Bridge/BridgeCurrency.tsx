import { useLingui } from "@lingui/react";
import { Avatar, Button } from "@mantine/core";
import { IconChevronDown } from "@tabler/icons-react";
import classes from "./BridgeCurrency.module.css";

export const BridgeCurrency: React.FC = () => {
	const { i18n } = useLingui();
	return (
		<Button
			leftSection={<Avatar src="/assets/tokens/usdc.png" size={24} />}
			rightSection={<IconChevronDown />}
			color="gray"
			variant="light"
			justify="space-between"
			classNames={classes}
			size="md"
			h={40}
		>
			{i18n._("USDC")}
		</Button>
	);
};
