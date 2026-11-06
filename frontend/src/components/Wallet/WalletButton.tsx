import { Badge, Button, Image } from "@mantine/core";
import type { Adapter } from "@solana/wallet-adapter-base";
import { useWallet, type Wallet } from "@solana/wallet-adapter-react";
import { useRouter } from "next/navigation";
import { useCallback } from "react";

export const WalletButton: React.FC<Wallet> = ({ adapter, readyState }) => {
	const { select, connecting } = useWallet();
	const router = useRouter();

	const handleSelectWallet = useCallback(
		(adapter: Adapter) => {
			if (adapter.readyState === "NotDetected") {
				router.push(adapter.url);
			}
			select(adapter.name);
		},
		[router, select],
	);

	if (adapter.name === "Bitget" && readyState === "Installed") {
		return null;
	}

	return (
		<Button
			loading={connecting}
			leftSection={
				<Image src={adapter.icon} width={24} height={24} alt={adapter.name} />
			}
			rightSection={
				readyState === "Installed" ? (
					<Badge size="xs" pos="absolute" right={10}>
						{"Installed"}
					</Badge>
				) : undefined
			}
			onClick={() => handleSelectWallet(adapter)}
			size="lg"
			justify="start"
			variant="light"
			color="gray"
		>
			{adapter.name}
		</Button>
	);
};
