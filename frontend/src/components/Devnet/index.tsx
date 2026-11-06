"use client";

import { useLingui } from "@lingui/react";
import { Button, Center, Stack, Text, Title } from "@mantine/core";
import { useWallet } from "@solana/wallet-adapter-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { notification } from "@/components/Notifications";
import {
	DEVNET_USDC_SYMBOL,
	FAUCET_CLAIM_AMOUNT,
} from "@/configs/devnetFaucet";
import { CardLayout } from "../Layout/CardLayout";

const formatCooldown = (ms: number) => {
	const hours = Math.floor(ms / (60 * 60 * 1000));
	const minutes = Math.floor((ms % (60 * 60 * 1000)) / (60 * 1000));
	return `${hours}h ${minutes}m`;
};

export const Devnet: React.FC = () => {
	const { i18n } = useLingui();
	const { connected, publicKey } = useWallet();
	const queryClient = useQueryClient();

	const statusQuery = useQuery({
		queryKey: ["faucet-status", publicKey?.toString()],
		queryFn: async () => {
			const res = await fetch(
				`/api/faucet/claim?wallet=${publicKey?.toString()}`,
			);
			if (!res.ok) throw new Error("Failed to check faucet status");
			return res.json() as Promise<{ retryAfterMs: number; claimAmount: number }>;
		},
		enabled: !!publicKey,
		refetchInterval: 60_000,
	});

	const claimMutation = useMutation({
		mutationFn: async () => {
			const res = await fetch("/api/faucet/claim", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ wallet: publicKey?.toString() }),
			});
			const data = await res.json();
			if (!res.ok) throw new Error(data.error ?? "Claim failed");
			return data as { signature: string; amount: number };
		},
		onSuccess: (data) => {
			notification.success({
				title: i18n._("Devnet Faucet"),
				message: i18n._("Claimed {amount} {symbol}", {
					amount: data.amount,
					symbol: DEVNET_USDC_SYMBOL,
				}),
			});
			queryClient.invalidateQueries({ queryKey: ["faucet-status"] });
		},
		onError: (error: Error) => {
			notification.error({
				title: i18n._("Devnet Faucet"),
				message: error.message,
			});
		},
	});

	const retryAfterMs = statusQuery.data?.retryAfterMs ?? 0;
	const onCooldown = retryAfterMs > 0;

	return (
		<CardLayout>
			<Stack gap="md" align="center" py="xl">
				<Title fs="xl">{i18n._("Devnet Faucet")}</Title>
				<Text c="gray" ta="center" maw={420}>
					{i18n._(
						"Claim {amount} {symbol} — a devnet-only test token, not real USDC — once every 24 hours per wallet.",
						{ amount: FAUCET_CLAIM_AMOUNT, symbol: DEVNET_USDC_SYMBOL },
					)}
				</Text>

				{!connected ? (
					<Center py="md">
						<Text c="gray">{i18n._("Connect Wallet")}</Text>
					</Center>
				) : (
					<Stack gap={4} align="center">
						<Button
							size="lg"
							loading={claimMutation.isPending}
							disabled={onCooldown || statusQuery.isLoading}
							onClick={() => claimMutation.mutate()}
						>
							{onCooldown
								? i18n._("Come back in {time}", {
										time: formatCooldown(retryAfterMs),
									})
								: i18n._("Claim {amount} {symbol}", {
										amount: FAUCET_CLAIM_AMOUNT,
										symbol: DEVNET_USDC_SYMBOL,
									})}
						</Button>
						{claimMutation.data && (
							<Text c="gray" fz="xs" ff="monospace">
								{claimMutation.data.signature}
							</Text>
						)}
					</Stack>
				)}
			</Stack>
		</CardLayout>
	);
};
