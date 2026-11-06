import { Avatar, Group, Text } from "@mantine/core";
import type { TokenInfo } from "@solana/spl-token-registry";
import { Handle, type NodeProps, Position } from "reactflow";

export const RouterNode = ({
	id,
	data,
	sourcePosition,
	targetPosition,
}: NodeProps<TokenInfo>) => {
	return (
		<Group gap={5}>
			{targetPosition === Position.Left && (
				<>
					<Handle type="target" position={Position.Left} />
					<Avatar src={data.logoURI} alt={data.symbol} id={id} size={24} />
				</>
			)}
			<Text fw="bold">{data.symbol}</Text>
			{sourcePosition === Position.Right && (
				<>
					<Handle type="source" position={Position.Right} />
					<Avatar src={data.logoURI} alt={data.symbol} id={id} size={24} />
				</>
			)}
		</Group>
	);
};
