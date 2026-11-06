import { generateAvatarURL } from "@cfx-kit/wallet-avatar";
import { useLingui } from "@lingui/react";
import {
	Anchor,
	Avatar,
	Box,
	Button,
	Group,
	Menu,
	Stack,
	Text,
} from "@mantine/core";
import { useWallet } from "@solana/wallet-adapter-react";
import { IconExternalLink, IconUnlink } from "@tabler/icons-react";
import { useNativeBalance } from "@/hooks/useNativeBalance";
import { formatAddress } from "@/lib/format";
import { useCluster } from "@/providers/ClusterProvider";
import { getExpolerUrl } from "@/utils/externalUrl";
import classes from "./Wallet.module.css";
import { AddressValue } from "../Token/AddressValue";
import { TokenBalance } from "../Token/TokenBalance";

export const ConnectedButton: React.FC = () => {
	const { publicKey, wallet, disconnect } = useWallet();
	const { network } = useCluster();

	const { i18n } = useLingui();
	const { data, isLoading } = useNativeBalance();

	return (
		<Menu shadow="md" width={300} trigger="click-hover">
			<Menu.Target>
				<Button unstyled className={classes.connected}>
					<Group gap={5}>
						{wallet && (
							<Avatar
								src={wallet?.adapter.icon}
								size={32}
								alt={wallet?.adapter.name}
							/>
						)}
						<Box visibleFrom="sm">
							{formatAddress(publicKey?.toBase58() || "")}
						</Box>
					</Group>
				</Button>
			</Menu.Target>

			<Menu.Dropdown
				p={10}
				style={{
					border: "none",
				}}
			>
				<Stack gap={10}>
					<Group align="center" justify="space-between" py={10}>
						<Group gap={10} align="center">
							<Avatar
								src={generateAvatarURL(publicKey?.toBase58() || "")}
								size={40}
								alt={wallet?.adapter.name}
							/>
							<Stack gap={0} lh={1}>
								<Box w={180}>
									<Text fw="bold" fz="xl" truncate="end">
										<TokenBalance
											balance={data}
											loading={isLoading}
											suffix=" SOL"
											decimalScale={8}
										/>
									</Text>
								</Box>

								<Box fz="sm" c="gray.12" mt={-5}>
									<AddressValue address={publicKey?.toBase58() || ""} label="wallet address" />
								</Box>
							</Stack>
						</Group>
						<Anchor
							href={getExpolerUrl(network, publicKey?.toBase58() || "")}
							target="_blank"
							rel="noopener noreferrer"
						>
							<IconExternalLink stroke={1.5} />
						</Anchor>
					</Group>
					<Button
						fullWidth
						variant="light"
						size="md"
						onClick={disconnect}
						leftSection={
							<IconUnlink stroke={1.5} color="var(--mantine-color-gray-10)" />
						}
					>
						{i18n._("Disconnect")}
					</Button>
				</Stack>
			</Menu.Dropdown>
		</Menu>
	);
};
