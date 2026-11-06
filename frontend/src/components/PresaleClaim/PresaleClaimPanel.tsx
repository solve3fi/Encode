"use client";

import { useLingui } from "@lingui/react";
import { Button, Stack, Text } from "@mantine/core";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { Transaction } from "@solana/web3.js";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { notification } from "@/components/Notifications";
import { ConnectButton } from "@/components/Wallet/ConnectButton";
import { PRESALE_TOKEN_SYMBOL } from "@/configs/presale";
import { hasClaimGas, MIN_CLAIM_SOL } from "@/lib/claimGas";
import { CardLayout } from "../Layout/CardLayout";

type PresaleStatus = {
	eligible: boolean;
	state?: "pending_activation" | "not_allocated" | "claimed" | "active";
	veSolv3Amount?: number;
	amountUsd?: number;
	minted?: boolean;
	mintedSignature?: string;
	locked?: boolean;
};

/**
 * One presale round's claim. Round 1 (Friends & Family) is the default and sends exactly the requests it always has;
 * round 2 (the public sale) claims from its own ledger and renders nothing for a wallet without a round-2 allocation.
 */
export const PresaleClaimPanel: React.FC<{ round?: 1 | 2 }> = ({ round = 1 }) => {
	const roundQuery = round === 2 ? "&round=2" : "";
	const roundBody = round === 2 ? { round: 2 } : {};
	const { i18n } = useLingui();
	const queryClient = useQueryClient();
	const { connection } = useConnection();
	const {
		publicKey: solanaAddress,
		connected: solanaConnected,
		signTransaction,
	} = useWallet();

	const statusQuery = useQuery({
		queryKey: ["presale-status", solanaAddress?.toString(), round],
		queryFn: async () => {
			const res = await fetch(
				`/api/presale/status?solanaAddress=${solanaAddress?.toString()}${roundQuery}`,
			);
			if (!res.ok) throw new Error("Failed to check eligibility");
			return res.json() as Promise<PresaleStatus>;
		},
		enabled: !!solanaAddress,
	});

	const claimMutation = useMutation({
		mutationFn: async () => {
			if (
				!solanaAddress ||
				!signTransaction ||
				!statusQuery.data?.eligible ||
				statusQuery.data.state === "pending_activation" ||
				!statusQuery.data.veSolv3Amount
			) {
				throw new Error(i18n._("Not eligible"));
			}

			if (!(await hasClaimGas(connection, solanaAddress))) {
				throw new Error(
					i18n._(
						"This wallet needs at least {sol} SOL to pay the claim's network fee and rent. Add SOL, then claim.",
						{ sol: MIN_CLAIM_SOL },
					),
				);
			}

			const buildRes = await fetch("/api/presale/claim", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					solanaAddress: solanaAddress.toString(),
					...roundBody,
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

			const finalizeRes = await fetch("/api/presale/finalize", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					solanaAddress: solanaAddress.toString(),
					signature: solanaSignature,
					...roundBody,
				}),
			});
			const finalizeData = await finalizeRes.json();
			if (!finalizeRes.ok)
				throw new Error(finalizeData.error ?? "Could not finalize claim");
			return finalizeData as { signature: string; veSolv3Amount: number };
		},
		onSuccess: (data) => {
			notification.success({
				title: i18n._("Presale"),
				message: i18n._(
					"Locked {amount} {symbol} into a permanent veSOLV3 position",
					{
						amount: data.veSolv3Amount,
						symbol: PRESALE_TOKEN_SYMBOL,
					},
				),
			});
			queryClient.invalidateQueries({ queryKey: ["presale-status"] });
		},
		onError: (error: Error) => {
			notification.error({ title: i18n._("Presale"), message: error.message });
		},
	});

	if (round === 2 && !statusQuery.data?.eligible) return null;

	return (
		<CardLayout>
		{round === 2 && (
			<Text fw={700} ta="center" pt="md">
				{i18n._("Presale round 2")}
			</Text>
		)}
		<Stack gap="md" align="center" py="xl">
			{!solanaConnected ? (
				<ConnectButton />
			) : (
				<Stack gap="sm" align="center" w="100%" maw={420}>
					<Text c="gray" fz="sm" ff="monospace">
						{solanaAddress?.toString()}
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
									"Allocated: {amount} {symbol} (${usd}) — claims pending activation",
									{
										amount: statusQuery.data.veSolv3Amount?.toLocaleString("en-US", {
											maximumFractionDigits: 9,
										}),
										usd: statusQuery.data.amountUsd?.toLocaleString(),
										symbol: PRESALE_TOKEN_SYMBOL,
									},
								)}
							</Text>
							<Text c="gray" ta="center" fz="sm">
								{i18n._(
									"Your wallet is included in a prepared presale snapshot that hasn't been activated yet.",
								)}
							</Text>
							<Button size="lg" disabled>
								{i18n._("Claims pending activation")}
							</Button>
						</Stack>
					) : !statusQuery.data?.eligible ? (
						<Text c="gray">
							{i18n._("This wallet isn't on the presale list.")}
						</Text>
					) : statusQuery.data.minted ? (
						<Stack gap={4} align="center">
							<Text fw="bold">
								{i18n._(
									"Already claimed {amount} {symbol} — locked permanently",
									{
										amount: statusQuery.data.veSolv3Amount,
										symbol: PRESALE_TOKEN_SYMBOL,
									},
								)}
							</Text>
							{statusQuery.data.mintedSignature && (
								<Text c="gray" fz="xs" ff="monospace">
									{statusQuery.data.mintedSignature}
								</Text>
							)}
						</Stack>
					) : (
						<Stack gap="sm" align="center" w="100%">
							<Text fw="bold">
								{i18n._("You're eligible for {amount} {symbol} (${usd})", {
									amount: statusQuery.data.veSolv3Amount,
									usd: statusQuery.data.amountUsd?.toLocaleString(),
									symbol: PRESALE_TOKEN_SYMBOL,
								})}
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
		</CardLayout>
	);
};
