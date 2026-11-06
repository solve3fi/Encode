import { Avatar, Group, Paper, Text } from "@mantine/core";
import { usePoolInfo } from "@/hooks/usePoolInfo";
import { useToken } from "@/hooks/useToken";

export const SwapRouterNode = ({
	poolAddress,
	splitPercent,
}: {
	poolAddress: string;
	splitPercent: number;
}) => {
	const { data: pool } = usePoolInfo(poolAddress);

	const tokenAInfo = useToken(pool?.getTokenAInfo().address.toString());
	const tokenBInfo = useToken(pool?.getTokenBInfo().address.toString());

	return pool ? (
		<Paper px={10} py={5}>
			<Group gap={5} align="center">
				<Avatar.Group>
					<Avatar
						size="sm"
						src={tokenAInfo?.logoURI}
						alt={tokenAInfo?.symbol}
					/>
					<Avatar
						size="sm"
						src={tokenBInfo?.logoURI}
						alt={tokenBInfo?.symbol}
					/>
				</Avatar.Group>
				<Text fz="xs" fw="bold">
					{tokenAInfo?.symbol}/{tokenBInfo?.symbol}
				</Text>
			</Group>
			<Text fz="xs" fw="bold" ta="center" lh={1} c="gray" pb={2}>
				{splitPercent}%
			</Text>
		</Paper>
	) : null;
};
