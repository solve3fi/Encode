import { useLingui } from "@lingui/react";
import { Avatar, Card, Flex, Group, Text } from "@mantine/core";
import type { TokenInfo } from "@solana/spl-token-registry";
import { IconRoute } from "@tabler/icons-react";
import ReactFlow, {
	type Edge,
	Handle,
	type Node,
	type NodeProps,
	type NodeTypes,
	Position,
} from "reactflow";
import { SOL } from "@/configs/tokens";
import "reactflow/dist/style.css";

const proOptions = { hideAttribution: true };

const initialNodes: Node[] = [
	{
		id: "1",
		position: { x: 0, y: 10 },
		data: SOL,
		type: "custom",
		sourcePosition: Position.Right,
	},
	{
		id: "2",
		position: { x: 180, y: 60 },
		data: { label: "USDC" },
		sourcePosition: Position.Right,
		targetPosition: Position.Left,
		type: "custom",
	},
	{
		id: "3",
		position: { x: 380, y: 60 },
		data: { label: "USDT" },
		sourcePosition: Position.Right,
		targetPosition: Position.Left,
		type: "custom",
	},
	{
		id: "4",
		position: { x: 640, y: 10 },
		data: SOL,
		type: "custom",
		targetPosition: Position.Left,
	},
];
const initialEdges: Edge[] = [
	{ id: "e1-2", source: "1", target: "2", type: "smoothstep", animated: true },
	{
		id: "e2-3",
		source: "2",
		target: "3",
		type: "smoothstep",
		animated: true,
	},
	{ id: "e3-4", source: "3", target: "4", type: "smoothstep", animated: true },
];

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

const nodeTypes = {
	custom: RouterNode,
};

export const SwapRouterReactFlow: React.FC = () => {
	const { i18n } = useLingui();
	return (
		<Card
			shadow="none"
			padding="lg"
			radius="md"
			withBorder={false}
			mih={100}
			bg="transparent"
		>
			<Card.Section>
				<Flex
					h={55}
					bg="purple.9"
					gap={10}
					justify="center"
					align="center"
					style={{ borderRadius: 8 }}
				>
					<IconRoute />
					<Text tt="uppercase" ta="center" fw="bold">
						{i18n._("Trade Router")}
					</Text>
				</Flex>
			</Card.Section>

			<Group h={100} justify="center" align="center">
				<ReactFlow
					nodes={initialNodes}
					edges={initialEdges}
					panOnDrag={false}
					zoomOnScroll={false}
					zoomOnPinch={false}
					zoomOnDoubleClick={false}
					preventScrolling={false}
					nodeTypes={nodeTypes as NodeTypes}
					proOptions={proOptions}
				/>
			</Group>
		</Card>
	);
};
