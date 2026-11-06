import {
	ActionIcon,
	Avatar,
	Group,
	Stack,
	Text,
	UnstyledButton,
} from "@mantine/core";
import type { TokenInfo } from "@solana/spl-token-registry";
import { IconArrowUpRight, IconBookmark } from "@tabler/icons-react";
import Link from "next/link";
import { useCluster } from "@/providers/ClusterProvider";
import { getExpolerUrl } from "@/utils/externalUrl";
import { AddressValue } from "./AddressValue";
import { CurrencyBalance } from "./CurrencyBalance";

export type TokenListProps = {
	onSelected: (token: TokenInfo) => void;
	token: TokenInfo;
};

export const TokenList: React.FC<TokenListProps> = ({ onSelected, token }) => {
	const { network } = useCluster();
	return (
		<Group align="center" justify="space-between">
			<Group
				component={UnstyledButton}
				align="center"
				miw={140}
				onClick={() => onSelected(token)}
			>
				<Avatar src={token?.logoURI} size={32} />
				<Stack gap={0} w={120}>
					<Text fz="lg" fw={600} lh={1}>
						{token?.symbol}
					</Text>
					<Text size="sm" c="gray.12" truncate="end">
						{token?.name}
					</Text>
				</Stack>
			</Group>

			<Group gap={2} wrap="nowrap">
				<AddressValue address={token?.address} label={`${token?.symbol || "token"} address`} />
				<ActionIcon component={Link} variant="transparent" href={getExpolerUrl(network, token?.address)} target="_blank" rel="noopener noreferrer" aria-label={`Open ${token?.symbol || "token"} in explorer`}>
					<IconArrowUpRight size={18} />
				</ActionIcon>
			</Group>

			<Group gap={5} flex={1} justify="flex-end">
				<Text fz="lg" fw={600} maw={94} truncate>
					<CurrencyBalance currency={token} />
				</Text>

				<ActionIcon variant="transparent" color="gray">
					<IconBookmark />
				</ActionIcon>
			</Group>
		</Group>
	);
};
