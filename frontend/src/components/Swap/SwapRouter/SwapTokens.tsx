import { Avatar, Group, Text } from "@mantine/core";
import type { TokenInfo } from "@solana/spl-token-registry";

export type SwapTokensProps = {
	from?: TokenInfo | null;
	to?: TokenInfo | null;
};

export const SwapTokens: React.FC<SwapTokensProps> = ({ from, to }) => {
	return (
		<Group gap={5} align="center">
			<Avatar.Group>
				<Avatar size="md" src={from?.logoURI} alt={from?.symbol} />
				<Avatar size="md" src={to?.logoURI} alt={to?.symbol} />
			</Avatar.Group>
			<Text fw="bold">
				{from?.symbol}/{to?.symbol}
			</Text>
		</Group>
	);
};
