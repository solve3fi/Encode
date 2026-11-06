"use client";

import { useLingui } from "@lingui/react";
import { Avatar, Button, Divider, Stack, Text } from "@mantine/core";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { Transaction } from "@solana/web3.js";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { type Connector, useAccount, useConnect, useSignMessage } from "wagmi";
import { notification } from "@/components/Notifications";
import { ConnectButton } from "@/components/Wallet/ConnectButton";
import { AIRDROP_TOKEN_SYMBOL } from "@/configs/airdrop";
import { buildAirdropClaimMessage } from "@/lib/airdropMessage";
import { hasClaimGas, MIN_CLAIM_SOL } from "@/lib/claimGas";
import { formatAddress } from "@/lib/format";
import { CardLayout } from "../Layout/CardLayout";
import { AirdropPartnerBreakdown } from "./AirdropPartnerBreakdown";

type AirdropStatus = {
	eligible: boolean;
	state?: "pending_activation" | "not_allocated" | "claimed" | "active";
	amount?: number;
	partnerAmountsRaw?: Record<string, string>;
	minted?: boolean;
	mintedSignature?: string;
	solanaAddress?: string;
	locked?: boolean;
};

// wagmi always keeps its own generic `injected` fallback connector alongside
// any wallet discovered via EIP-6963 (MetaMask, Coinbase Wallet, Rainbow,
// Brave, etc. each announce themselves separately). Once a real wallet has
// been discovered, showing the generic one too is just a confusing duplicate
// entry pointing at the same window.ethereum.
const dedupeConnectors = (connectors: readonly Connector[]): Connector[] =>
	connectors.length > 1
		? connectors.filter((connector) => connector.id !== "injected")
		: [...connectors];

export const AirdropClaimPanel: React.FC = () => {
	const { i18n } = useLingui();
	const queryClient = useQueryClient();
	const { connection } = useConnection();
	const {
		publicKey: solanaAddress,
		connected: solanaConnected,
		signTransaction,
	} = useWallet();
	const { address } = useAccount();
	const { connectors: rawConnectors, connectAsync } = useConnect();
	const { signMessageAsync } = useSignMessage();
	const connectors = useMemo(
		() => dedupeConnectors(rawConnectors),
		[rawConnectors],
	);
	const ethAddress = address ? address.toLowerCase() : null;

	const statusQuery = useQuery({
		queryKey: ["airdrop-status", ethAddress],
		queryFn: async () => {
			const res = await fetch(`/api/airdrop/status?ethAddress=${ethAddress}`);
			if (!res.ok) throw new Error("Failed to check eligibility");
			return res.json() as Promise<AirdropStatus>;
		},
		enabled: !!ethAddress,
	});

	const connectMutation = useMutation({
		mutationFn: async (connector: Connector) => {
			try {
				const result = await connectAsync({ connector });
				if (!result.accounts?.[0])
					throw new Error(i18n._("No account returned"));
				return result.accounts[0];
			} catch (error) {
				if (error instanceof Error && error.name === "ProviderNotFoundError") {
					throw new Error(
						i18n._(
							"No Ethereum wallet found — install MetaMask or a compatible extension.",
						),
					);
				}
				throw error;
			}
		},
		onError: (error: Error) => {
			notification.error({ title: i18n._("Airdrop"), message: error.message });
		},
	});

	const claimMutation = useMutation({
		mutationFn: async () => {
			if (
				!ethAddress ||
				!solanaAddress ||
				!signTransaction ||
				!statusQuery.data?.eligible ||
				statusQuery.data.state === "pending_activation" ||
				!statusQuery.data.amount
			) {
				throw new Error(i18n._("Not eligible"));
			}

			if (!address) throw new Error(i18n._("Ethereum wallet not found"));

			if (!(await hasClaimGas(connection, solanaAddress))) {
				throw new Error(
					i18n._(
						"This wallet needs at least {sol} SOL to pay the claim's network fee and rent. Add SOL, then claim.",
						{ sol: MIN_CLAIM_SOL },
					),
				);
			}

			const message = buildAirdropClaimMessage(
				statusQuery.data.amount,
				solanaAddress.toString(),
			);
			const ethSignature = await signMessageAsync({
				account: address,
				message,
			});

			const buildRes = await fetch("/api/airdrop/claim", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					ethAddress,
					solanaAddress: solanaAddress.toString(),
					signature: ethSignature,
				}),
			});
			const buildData = await buildRes.json();
			if (!buildRes.ok)
				throw new Error(buildData.error ?? "Could not build claim transaction");

			const transaction = Transaction.from(
				Buffer.from(buildData.transaction, "base64"),
			);
			const signedTransaction = await signTransaction(transaction);
			const solanaSignature = await connection.sendRawTransaction(
				signedTransaction.serialize(),
			);
			await connection.confirmTransaction(solanaSignature, "confirmed");

			const finalizeRes = await fetch("/api/airdrop/finalize", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					ethAddress,
					solanaAddress: solanaAddress.toString(),
					signature: solanaSignature,
				}),
			});
			const finalizeData = await finalizeRes.json();
			if (!finalizeRes.ok)
				throw new Error(finalizeData.error ?? "Could not finalize claim");
			return finalizeData as { signature: string; amount: number };
		},
		onSuccess: (data) => {
			notification.success({
				title: i18n._("Airdrop"),
				message: i18n._(
					"Locked {amount} {symbol} into a permanent veSOLV3 position",
					{
						amount: data.amount,
						symbol: AIRDROP_TOKEN_SYMBOL,
					},
				),
			});
			queryClient.invalidateQueries({ queryKey: ["airdrop-status"] });
		},
		onError: (error: Error) => {
			notification.error({ title: i18n._("Airdrop"), message: error.message });
		},
	});

	return (
		<CardLayout>
			<Stack gap="md" align="center" py="xl">
				{!ethAddress ? (
					connectors.length > 0 ? (
						<Stack gap="xs" w="100%" maw={320}>
							{connectors.map((connector) => (
								<Button
									key={connector.uid}
									size="lg"
									variant={connectors.length > 1 ? "default" : "filled"}
									justify="flex-start"
									leftSection={
										connector.icon ? (
											<Avatar src={connector.icon} size={20} radius="sm" />
										) : undefined
									}
									loading={
										connectMutation.isPending &&
										connectMutation.variables?.uid === connector.uid
									}
									onClick={() => connectMutation.mutate(connector)}
								>
									{connectors.length > 1
										? connector.name
										: i18n._("Connect Ethereum Wallet")}
								</Button>
							))}
						</Stack>
					) : (
						<Text c="red" ta="center" maw={420}>
							{i18n._(
								"No Ethereum wallet found — install MetaMask or a compatible extension.",
							)}
						</Text>
					)
				) : (
					<Stack gap="sm" align="center" w="100%" maw={420}>
						<Text c="gray" fz="sm" ff="monospace">
							{ethAddress}
						</Text>

						{statusQuery.isLoading ? (
							<Text c="gray">{i18n._("Loading…")}</Text>
						) : statusQuery.isError ? (
							<Stack gap="sm" align="center">
								<Text c="red">
									{i18n._("Unable to check your allocation. Please try again.")}
								</Text>
								<Button variant="light" onClick={() => statusQuery.refetch()}>
									{i18n._("Retry")}
								</Button>
							</Stack>
						) : statusQuery.data?.state === "pending_activation" ? (
							<Stack gap="sm" align="center">
								<Text fw="bold" ta="center">
									{i18n._(
										"Allocated: {amount} {symbol} — claims pending activation",
										{
											amount: statusQuery.data.amount?.toLocaleString("en-US", {
												maximumFractionDigits: 9,
											}),
											symbol: AIRDROP_TOKEN_SYMBOL,
										},
									)}
								</Text>
								<Text c="gray" ta="center" fz="sm">
									{i18n._(
										"Your wallet is included in a prepared airdrop snapshot that hasn't been activated yet.",
									)}
								</Text>
								<AirdropPartnerBreakdown
									partnerAmountsRaw={statusQuery.data.partnerAmountsRaw}
								/>
								<Button size="lg" disabled>
									{i18n._("Claims pending activation")}
								</Button>
							</Stack>
						) : !statusQuery.data?.eligible ? (
							<Text c="gray">
								{i18n._("This address isn't on the airdrop list.")}
							</Text>
						) : statusQuery.data.minted ? (
							<Stack gap={4} align="center">
								<Text fw="bold">
									{i18n._(
										"Already claimed {amount} {symbol} — locked permanently",
										{
											amount: statusQuery.data.amount,
											symbol: AIRDROP_TOKEN_SYMBOL,
										},
									)}
								</Text>
								<Text c="gray" fz="xs" ff="monospace">
									{i18n._("Locked to")} {statusQuery.data.solanaAddress}
								</Text>
								{statusQuery.data.mintedSignature && (
									<Text c="gray" fz="xs" ff="monospace">
										{statusQuery.data.mintedSignature}
									</Text>
								)}
								<AirdropPartnerBreakdown
									partnerAmountsRaw={statusQuery.data.partnerAmountsRaw}
								/>
							</Stack>
						) : (
							<Stack gap="sm" align="center" w="100%">
								<Text fw="bold">
									{i18n._("You're eligible for {amount} {symbol}", {
										amount: statusQuery.data.amount,
										symbol: AIRDROP_TOKEN_SYMBOL,
									})}
								</Text>
								<AirdropPartnerBreakdown
									partnerAmountsRaw={statusQuery.data.partnerAmountsRaw}
								/>
								<Divider
									w="100%"
									label={i18n._("Destination")}
									labelPosition="center"
								/>
								{!solanaConnected ? (
									<Stack gap={4} align="center">
										<Text c="gray" fz="sm" ta="center">
											{i18n._(
												"Connect the Solana wallet that will hold your permanent veSOLV3 position.",
											)}
										</Text>
										<ConnectButton />
									</Stack>
								) : (
									<Stack gap="sm" align="center" w="100%">
										<Text c="gray" fz="sm" ff="monospace">
											{formatAddress(solanaAddress?.toString() ?? "")}
										</Text>
										<Button
											size="lg"
											loading={claimMutation.isPending}
											onClick={() => claimMutation.mutate()}
										>
											{i18n._("Claim & Lock Permanently")}
										</Button>
									</Stack>
								)}
							</Stack>
						)}
					</Stack>
				)}
			</Stack>
		</CardLayout>
	);
};
