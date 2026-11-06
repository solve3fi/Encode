import { Avatar, Button } from "@mantine/core";
import type { TokenListProps } from "./TokenList";

export const BaseTokenList: React.FC<TokenListProps> = ({
	onSelected,
	token,
}) => {
	return (
		<Button
			variant="light"
			color="gray"
			px={7}
			onClick={() => onSelected(token)}
			leftSection={<Avatar src={token?.logoURI} size={24} />}
		>
			{token?.symbol}
		</Button>
	);
};
