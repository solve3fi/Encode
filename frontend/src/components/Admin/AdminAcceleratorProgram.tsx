"use client";

import { useLingui } from "@lingui/react";
import {
	Alert,
	Badge,
	Button,
	Group,
	NumberInput,
	Select,
	Stack,
	Switch,
	Table,
	Text,
	TextInput,
} from "@mantine/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { notification } from "@/components/Notifications";
import {
	ACCELERATOR_CONFIG_SET_ACTION,
	ACCELERATOR_ELIGIBILITY_THRESHOLD_PCT,
	ACCELERATOR_MAX_MATCH_PCT,
	ACCELERATOR_PARTNER_ADD_ACTION,
	ACCELERATOR_PARTNER_REMOVE_ACTION,
	ACCELERATOR_PARTNER_UPDATE_ACTION,
	type AcceleratorConfig,
	type AcceleratorPartner,
	type AcceleratorPartnersById,
	acceleratorConfigPayload,
} from "@/configs/acceleratorProgram";
import type { AdminAutoVoteWalletPublic } from "@/configs/autoVoteWallets";
import { AUTO_VOTE_WALLET_UPDATE_ACTION } from "@/configs/autoVoteWallets";
import { useAdminAuth } from "@/hooks/useAdminAuth";
import { useAllTokens } from "@/hooks/useToken";
import { formatAddress } from "@/lib/format";
import { gaugeVotingPower, votingPowerUnits } from "@/lib/voteDisplay";
import { useCluster } from "@/providers/ClusterProvider";
import { useAdminPickers } from "@/stores/admin/hooks/useAdminPickers";
import { useWalletHoldings } from "@/stores/admin/hooks/useWalletHoldings";
import { usePools } from "@/stores/pool/hooks/usePools";
import { useVote } from "@/stores/vote/hooks/useVote";
import { useVoteConfig } from "@/stores/vote/hooks/useVoteConfig";
import { useVotes } from "@/stores/vote/hooks/useVotes";
import { useUserVote } from "@/stores/vote/hooks/useUserVote";
import { CardLayout } from "../Layout/CardLayout";

type AdminAutoVoteWalletsPublicById = Record<string, AdminAutoVoteWalletPublic>;

type PartnerMatch = {
	partner: AcceleratorPartner;
	label: string;
	epochsElapsed: number;
	epochsRemaining: number;
	sharePct: number;
	eligible: boolean;
	suggestedWalletPct: number;
};

export const AdminAcceleratorProgram: React.FC = () => {
	const { i18n } = useLingui();
	const { network } = useCluster();
	const { sign } = useAdminAuth();
	const queryClient = useQueryClient();
	const tokenMap = useAllTokens();

	const { data: voteConfig } = useVoteConfig(network);
	const currentEpoch = voteConfig?.epoch.toNumber() || 0;
	const { data: epochSnapshot } = useVote(network, currentEpoch);
	const { data: votes } = useVotes(network, currentEpoch);
	const { data: pools } = usePools(
		network,
		votes?.map((item) => item.pool.toBase58()) || [],
	);

	// Every live pool, not only the ones that already have votes this epoch.
	const { poolOptions } = useAdminPickers();

	const configQuery = useQuery({
		queryKey: ["admin-accelerator-config"],
		queryFn: async () => {
			const res = await fetch("/api/admin/accelerator-config");
			if (!res.ok) throw new Error("Failed to load");
			return res.json() as Promise<AcceleratorConfig>;
		},
	});

	const walletsQuery = useQuery({
		queryKey: ["admin-auto-vote-wallets"],
		queryFn: async () => {
			const res = await fetch("/api/admin/auto-vote-wallets");
			if (!res.ok) throw new Error("Failed to load");
			return res.json() as Promise<AdminAutoVoteWalletsPublicById>;
		},
	});

	const partnersQuery = useQuery({
		queryKey: ["admin-accelerator-partners"],
		queryFn: async () => {
			const res = await fetch("/api/admin/accelerator-partners");
			if (!res.ok) throw new Error("Failed to load");
			return res.json() as Promise<AcceleratorPartnersById>;
		},
	});

	const automatic = configQuery.data?.automatic !== false;
	const activationEpoch = configQuery.data?.activationEpoch;
	const scheduled = activationEpoch !== undefined && currentEpoch < activationEpoch;
	const selectedLockId = Number(configQuery.data?.veTokenId ?? 0);
	const { data: acceleratorVote } = useUserVote(network, currentEpoch, selectedLockId);
	const externalSnapshot = useMemo(() => {
		if (!epochSnapshot || !acceleratorVote) return epochSnapshot;
		const votePowers = epochSnapshot.votePowers.map((power, index) => {
			const own = acceleratorVote.votes.find(vote => vote.gauge.equals(epochSnapshot.votePools[index]))?.weight;
			return own && power.gte(own) ? power.sub(own) : power;
		});
		const votes = votePowers.reduce((sum, power) => sum.add(power), epochSnapshot.votes.sub(epochSnapshot.votes));
		return { ...epochSnapshot, votes, votePowers };
	}, [epochSnapshot, acceleratorVote]);
	// With a single auto-vote wallet there is nothing to choose: it is the accelerator wallet.
	const singleWallet =
		Object.keys(walletsQuery.data ?? {}).length === 1
			? Object.keys(walletsQuery.data ?? {})[0]
			: undefined;
	const acceleratorWalletPubkey =
		configQuery.data?.acceleratorWalletPubkey ?? singleWallet;
	const { data: walletHoldings } = useWalletHoldings(acceleratorWalletPubkey);
	const walletOptions = useMemo(
		() =>
			Object.values(walletsQuery.data ?? {}).map((wallet) => ({
				value: wallet.pubkey,
				label: `${wallet.label} — ${formatAddress(wallet.pubkey)}`,
			})),
		[walletsQuery.data],
	);

	const [poolAddress, setPoolAddress] = useState<string | null>(null);
	const [projectName, setProjectName] = useState("");
	const [maxEpochs, setMaxEpochs] = useState(4);
	const [lockDraft, setLockDraft] = useState<string | null>(null);

	const setWalletMutation = useMutation({
		mutationFn: async (input: { pubkey?: string; automatic?: boolean; veTokenId?: string }) => {
			const pubkey = input.pubkey ?? (input.veTokenId !== undefined ? acceleratorWalletPubkey : undefined);
			const { wallet, message, signature } = await sign(
				ACCELERATOR_CONFIG_SET_ACTION,
				acceleratorConfigPayload({ acceleratorWalletPubkey: pubkey, automatic: input.automatic, veTokenId: input.veTokenId }),
			);
			const res = await fetch("/api/admin/accelerator-config", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					wallet,
					message,
					signature,
					acceleratorWalletPubkey: pubkey,
					automatic: input.automatic,
					veTokenId: input.veTokenId,
				}),
			});
			const data = await res.json();
			if (!res.ok) throw new Error(data.error ?? "Save failed");
			return data.config as AcceleratorConfig;
		},
		onSuccess: (config) => {
			queryClient.setQueryData(["admin-accelerator-config"], config);
			setLockDraft(null);
		},
		onError: (error: Error) => {
			notification.error({
				title: i18n._("Accelerator Program"),
				message: error.message,
			});
		},
	});

	const addPartnerMutation = useMutation({
		mutationFn: async () => {
			if (!poolAddress || !projectName.trim())
				throw new Error("Fill in all fields");
			const { wallet, message, signature } = await sign(
				ACCELERATOR_PARTNER_ADD_ACTION,
				{
					poolAddress,
					projectName,
					enrolledAtEpoch: currentEpoch,
					maxEpochs,
					notes: "",
				},
			);
			const res = await fetch("/api/admin/accelerator-partners", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					wallet,
					message,
					signature,
					poolAddress,
					projectName,
					enrolledAtEpoch: currentEpoch,
					maxEpochs,
				}),
			});
			const data = await res.json();
			if (!res.ok) throw new Error(data.error ?? "Save failed");
			return data.partner as AcceleratorPartner;
		},
		onSuccess: (partner) => {
			queryClient.setQueryData<AcceleratorPartnersById>(
				["admin-accelerator-partners"],
				(prev) => ({ ...prev, [partner.poolAddress]: partner }),
			);
			notification.success({
				title: i18n._("Accelerator Program"),
				message: i18n._("Partner enrolled"),
			});
			setPoolAddress(null);
			setProjectName("");
			setMaxEpochs(4);
		},
		onError: (error: Error) => {
			notification.error({
				title: i18n._("Accelerator Program"),
				message: error.message,
			});
		},
	});

	const updateStatusMutation = useMutation({
		mutationFn: async ({
			address,
			status,
		}: {
			address: string;
			status: "completed" | "removed";
		}) => {
			const { wallet, message, signature } = await sign(
				ACCELERATOR_PARTNER_UPDATE_ACTION,
				{ poolAddress: address, status, maxEpochs: 0, notes: "" },
			);
			const res = await fetch("/api/admin/accelerator-partners", {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					wallet,
					message,
					signature,
					poolAddress: address,
					status,
				}),
			});
			const data = await res.json();
			if (!res.ok) throw new Error(data.error ?? "Update failed");
			return data.partner as AcceleratorPartner;
		},
		onSuccess: (partner) => {
			queryClient.setQueryData<AcceleratorPartnersById>(
				["admin-accelerator-partners"],
				(prev) => ({ ...prev, [partner.poolAddress]: partner }),
			);
		},
		onError: (error: Error) => {
			notification.error({
				title: i18n._("Accelerator Program"),
				message: error.message,
			});
		},
	});

	const removeMutation = useMutation({
		mutationFn: async (address: string) => {
			const { wallet, message, signature } = await sign(
				ACCELERATOR_PARTNER_REMOVE_ACTION,
				{ poolAddress: address },
			);
			const res = await fetch("/api/admin/accelerator-partners", {
				method: "DELETE",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					wallet,
					message,
					signature,
					poolAddress: address,
				}),
			});
			const data = await res.json();
			if (!res.ok) throw new Error(data.error ?? "Remove failed");
			return address;
		},
		onSuccess: (address) => {
			queryClient.setQueryData<AcceleratorPartnersById>(
				["admin-accelerator-partners"],
				(prev) => {
					const next = { ...prev };
					delete next[address];
					return next;
				},
			);
		},
		onError: (error: Error) => {
			notification.error({
				title: i18n._("Accelerator Program"),
				message: error.message,
			});
		},
	});

	const applyMutation = useMutation({
		mutationFn: async (pools: { poolAddress: string; percent: number }[]) => {
			if (!acceleratorWalletPubkey)
				throw new Error("No accelerator wallet designated");
			const { wallet, message, signature } = await sign(
				AUTO_VOTE_WALLET_UPDATE_ACTION,
				{ pubkey: acceleratorWalletPubkey, label: "", pools },
			);
			const res = await fetch("/api/admin/auto-vote-wallets", {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					wallet,
					message,
					signature,
					pubkey: acceleratorWalletPubkey,
					pools,
				}),
			});
			const data = await res.json();
			if (!res.ok) throw new Error(data.error ?? "Apply failed");
			return data.wallet as AdminAutoVoteWalletPublic;
		},
		onSuccess: (wallet) => {
			queryClient.setQueryData<AdminAutoVoteWalletsPublicById>(
				["admin-auto-vote-wallets"],
				(prev) => ({ ...prev, [wallet.pubkey]: wallet }),
			);
			notification.success({
				title: i18n._("Accelerator Program"),
				message: i18n._("Match allocation applied to the accelerator wallet"),
			});
		},
		onError: (error: Error) => {
			notification.error({
				title: i18n._("Accelerator Program"),
				message: error.message,
			});
		},
	});

	// The core matching computation from docs.solve3.fi/more/accelerator-program:
	// a partner earning >=2% of total votes gets matched by that same amount
	// (capped at 10%), added as extra votes cast by the accelerator's own
	// veSOLV3. The accelerator only has so much voting power of its own, so
	// when the total desired match across all active partners exceeds what it
	// can actually cast, everyone's match is scaled down proportionally —
	// that's the "proportional to other Accelerator program participants"
	// language in the docs. This produces a SUGGESTED allocation; the docs
	// call the actual match "at discretion", so applying it is a deliberate
	// admin action below, not automatic.
	const activePartners = Object.values(partnersQuery.data ?? {}).filter(
		(partner) => partner.status === "active",
	);

	const totalVotingPower = externalSnapshot
		? votingPowerUnits(externalSnapshot.votes)
		: 0;
	const acceleratorPower = selectedLockId
		? walletHoldings?.lockPositions.find(lock => lock.veTokenId === selectedLockId)?.votingPower ?? 0
		: 0;
	const acceleratorPowerPctOfTotal =
		totalVotingPower > 0 ? (acceleratorPower / totalVotingPower) * 100 : 0;

	const partnerMatches: PartnerMatch[] = useMemo(() => {
		if (!externalSnapshot || totalVotingPower <= 0) return [];

		const withShares = activePartners.map((partner) => {
			const gauge = votes?.find(
				(v) => v.pool.toBase58() === partner.poolAddress,
			)?.gauge;
			const weight = gaugeVotingPower(externalSnapshot, gauge);
			const sharePct = (votingPowerUnits(weight) / totalVotingPower) * 100;
			const eligible = sharePct >= ACCELERATOR_ELIGIBILITY_THRESHOLD_PCT;
			const desiredMatchPct = eligible
				? Math.min(sharePct, ACCELERATOR_MAX_MATCH_PCT)
				: 0;
			const epochsElapsed = Math.max(0, currentEpoch - partner.enrolledAtEpoch);
			return {
				partner,
				label:
					poolOptions.find((option) => option.value === partner.poolAddress)
						?.label ?? formatAddress(partner.poolAddress),
				epochsElapsed,
				epochsRemaining: Math.max(0, partner.maxEpochs - epochsElapsed),
				sharePct,
				eligible,
				desiredMatchPct,
			};
		});

		const totalDesiredPct = withShares.reduce(
			(sum, p) => sum + p.desiredMatchPct,
			0,
		);
		const scalingFactor =
			totalDesiredPct > acceleratorPowerPctOfTotal && totalDesiredPct > 0
				? acceleratorPowerPctOfTotal / totalDesiredPct
				: 1;

		return withShares.map(({ desiredMatchPct, ...rest }) => {
			const finalMatchPctOfTotal = desiredMatchPct * scalingFactor;
			const suggestedWalletPct =
				acceleratorPowerPctOfTotal > 0
					? Math.max(
							0,
							Math.min(
								100,
								Math.round(
									(finalMatchPctOfTotal / acceleratorPowerPctOfTotal) * 100,
								),
							),
						)
					: 0;
			return { ...rest, suggestedWalletPct };
		});
	}, [
		activePartners,
		externalSnapshot,
		votes,
		totalVotingPower,
		acceleratorPowerPctOfTotal,
		currentEpoch,
		poolOptions,
	]);

	const suggestedPools = partnerMatches
		.filter((m) => m.suggestedWalletPct > 0)
		.map((m) => ({
			poolAddress: m.partner.poolAddress,
			percent: m.suggestedWalletPct,
		}));

	return (
		<CardLayout>
			<Stack gap="md">
				<Text fz="lg" fw="bold">
					{i18n._("Accelerator Program")}
				</Text>
				{activationEpoch !== undefined && (
					<Alert color={scheduled ? "blue" : "green"}>
						{i18n._("Automatic matching starts in epoch {epoch}, using lock {lock}. Partners must earn at least 2% of votes from other locks.", { epoch: activationEpoch, lock: selectedLockId })}
					</Alert>
				)}
				<Text fz="sm" c="gray">
					{i18n._(
						'Partner projects in the Accelerator Program and the suggested vote match per docs.solve3.fi/more/accelerator-program. With Automatic on, everything below happens by itself every epoch; the controls here are manual overrides.',
					)}
				</Text>

				<Switch
					checked={automatic}
					disabled={setWalletMutation.isPending}
					onChange={(event) =>
						setWalletMutation.mutate({ automatic: event.currentTarget.checked })
					}
					label={i18n._("Automatic")}
					description={i18n._(
						"Every epoch the keeper enrols partner applications that asked for the program once their pool has an active gauge, ends partners after their last epoch, and sets the accelerator wallet's votes to the suggested match before voting closes. No clicks needed.",
					)}
				/>
				{walletOptions.length > 1 ? (
					<Select
						label={i18n._("Accelerator wallet")}
						description={i18n._(
							"Which Admin Auto-Vote wallet holds the Accelerator Program's veSOLV3. Its pool allocation is what the match updates.",
						)}
						placeholder={i18n._("Select a wallet…")}
						data={walletOptions}
						value={acceleratorWalletPubkey ?? null}
						onChange={(value) => value && setWalletMutation.mutate({ pubkey: value })}
						searchable
					/>
				) : walletOptions.length === 1 ? (
					<Text fz="sm" c="gray">
						{i18n._("Accelerator wallet: {wallet} (the only auto-vote wallet, chosen automatically)", {
							wallet: walletOptions[0].label,
						})}
					</Text>
				) : null}
				{acceleratorWalletPubkey && (
					<Group align="flex-end">
						<Select
							label={i18n._("Accelerator lock ID")}
							description={i18n._("Choose a lock held by this wallet. Clear any standing allocation first.")}
							placeholder={i18n._("Select a lock")}
							data={(walletHoldings?.lockPositions ?? []).map(lock => ({ value: String(lock.veTokenId), label: `Lock ${lock.veTokenId} — ${lock.votingPower.toLocaleString()} veSOLV3` }))}
							value={lockDraft ?? configQuery.data?.veTokenId ?? null}
							onChange={setLockDraft}
							disabled={setWalletMutation.isPending}
							style={{ flex: 1, minWidth: 220 }}
						/>
						<Button loading={setWalletMutation.isPending} disabled={!lockDraft || lockDraft === configQuery.data?.veTokenId} onClick={() => lockDraft && setWalletMutation.mutate({ veTokenId: lockDraft })}>
							{i18n._("Save lock ID")}
						</Button>
					</Group>
				)}
				{!acceleratorWalletPubkey && (
					<Alert color="orange">
						{i18n._(
							"No accelerator wallet yet. Add the wallet that holds the program's veSOLV3 under Admin Auto-Vote Wallets; it is picked up automatically.",
						)}
					</Alert>
				)}
				{acceleratorWalletPubkey && (
					<Text fz="xs" c="gray">
						{i18n._(
							"Accelerator voting power: {power} ({pct}% of this epoch's total)",
							{
								power: acceleratorPower.toLocaleString(),
								pct: acceleratorPowerPctOfTotal.toFixed(2),
							},
						)}
					</Text>
				)}

				<Group align="flex-end" gap="sm" wrap="wrap">
					<TextInput
						label={i18n._("Project name")}
						placeholder={i18n._("e.g. Acme Protocol")}
						value={projectName}
						onChange={(event) => setProjectName(event.currentTarget.value)}
						flex={1}
						miw={200}
					/>
					<Select
						label={i18n._("Pool")}
						placeholder={i18n._("Select a pool…")}
						data={poolOptions}
						value={poolAddress}
						onChange={setPoolAddress}
						searchable
						flex={1}
						miw={220}
					/>
					<NumberInput
						label={i18n._("Max epochs")}
						min={1}
						max={12}
						value={maxEpochs}
						onChange={(value) => setMaxEpochs(Number(value) || 4)}
						w={110}
					/>
					<Button
						loading={addPartnerMutation.isPending}
						disabled={!poolAddress || !projectName.trim()}
						onClick={() => addPartnerMutation.mutate()}
					>
						{i18n._("Enroll partner")}
					</Button>
				</Group>

				<Table.ScrollContainer minWidth={860}>
					<Table verticalSpacing="sm">
						<Table.Thead>
							<Table.Tr>
								<Table.Th>{i18n._("Project")}</Table.Th>
								<Table.Th>{i18n._("Epoch")}</Table.Th>
								<Table.Th>{i18n._("Vote share")}</Table.Th>
								<Table.Th>{i18n._("Suggested match")}</Table.Th>
								<Table.Th>{i18n._("Actions")}</Table.Th>
							</Table.Tr>
						</Table.Thead>
						<Table.Tbody>
							{partnerMatches.length === 0 && (
								<Table.Tr>
									<Table.Td colSpan={5}>
										<Text c="gray" ta="center" py="md">
											{partnersQuery.isLoading
												? i18n._("Loading…")
												: i18n._("No active accelerator partners")}
										</Text>
									</Table.Td>
								</Table.Tr>
							)}
							{partnerMatches.map((match) => (
								<Table.Tr key={match.partner.poolAddress}>
									<Table.Td>
										<Stack gap={0}>
											<Text fw="bold">{match.partner.projectName}</Text>
											<Text fz="xs" c="gray">
												{match.label}
											</Text>
										</Stack>
									</Table.Td>
									<Table.Td>
										{match.epochsElapsed} / {match.partner.maxEpochs}
										{match.epochsRemaining === 0 && (
											<Badge ml={6} color="orange" variant="light">
												{i18n._("Expired")}
											</Badge>
										)}
									</Table.Td>
									<Table.Td>
										<Group gap={6}>
											<Text fw="bold">{match.sharePct.toFixed(2)}%</Text>
											<Badge
												color={match.eligible ? "green" : "gray"}
												variant="light"
											>
												{match.eligible
													? i18n._("Eligible")
													: i18n._("Below 2%")}
											</Badge>
										</Group>
									</Table.Td>
									<Table.Td>
										<Text fw="bold">
											{i18n._("{pct}% of wallet", {
												pct: match.suggestedWalletPct,
											})}
										</Text>
									</Table.Td>
									<Table.Td>
										<Group gap="xs">
											<Button
												size="xs"
												variant="light"
												color="red"
												onClick={() =>
													updateStatusMutation.mutate({
														address: match.partner.poolAddress,
														status: "completed",
													})
												}
											>
												{i18n._("Mark completed")}
											</Button>
											<Button
												size="xs"
												variant="light"
												color="red"
												loading={
													removeMutation.isPending &&
													removeMutation.variables === match.partner.poolAddress
												}
												onClick={() =>
													removeMutation.mutate(match.partner.poolAddress)
												}
											>
												{i18n._("Remove")}
											</Button>
										</Group>
									</Table.Td>
								</Table.Tr>
							))}
						</Table.Tbody>
					</Table>
				</Table.ScrollContainer>

				{suggestedPools.length > 0 && (
					<Group justify="flex-end">
						<Button
							loading={applyMutation.isPending}
							disabled={!acceleratorWalletPubkey || scheduled || !automatic}
							onClick={() => applyMutation.mutate(suggestedPools)}
						>
							{i18n._("Apply suggested match to accelerator wallet")}
						</Button>
					</Group>
				)}

				<Text fz="xs" c="gray">
					{i18n._(configQuery.data?.recyclingEnabled
						? "Rewards from matched votes are automatically claimed and deposited into the same partner's bribe pool in the following epoch. Epoch 3 matched rewards fund epoch 4. Unsupported or paused tokens remain pending."
						: "Automatic reward recycling is disabled. Create the bribe manually from the Bribes page once rewards are claimable.")}
				</Text>
			</Stack>
		</CardLayout>
	);
};
