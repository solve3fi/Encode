"use client";

import { useLingui } from "@lingui/react";
import { Badge, Button, Group, Select, Stack, Switch, Text, TextInput } from "@mantine/core";
import { useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { useMemo, useState } from "react";
import { formatAddress } from "@/lib/format";
import {
	type PauseFlags,
	useAcceptAdmin,
	useAdminConfig,
	useBribeTokenPolicy,
	useProposeAdmin,
	useSetBribeToken,
	useSetGateThreshold,
	useSetPauses,
	useSetTreasury,
} from "@/stores/admin/hooks/useProtocolControls";
import { useAdminPickers } from "@/stores/admin/hooks/useAdminPickers";
import { useSweepUngaugedFees } from "@/stores/admin/hooks/useSweepUngaugedFees";
import { CardLayout } from "../Layout/CardLayout";
import { AdminPartnerVoters } from "./AdminPartnerVoters";

const toKey = (value: string): PublicKey | null => {
	try {
		return value.trim() ? new PublicKey(value.trim()) : null;
	} catch {
		return null;
	}
};

export const AdminProtocolControls: React.FC = () => {
	const { i18n } = useLingui();
	const { publicKey } = useWallet();
	const { data: config } = useAdminConfig();
	const setPauses = useSetPauses();
	const proposeAdmin = useProposeAdmin();
	const acceptAdmin = useAcceptAdmin();
	const setBribeToken = useSetBribeToken();
	const setGate = useSetGateThreshold();
	const setTreasury = useSetTreasury();
	const sweepFees = useSweepUngaugedFees();
	const { ungaugedPoolOptions, tokenOptions, isLoading: pickersLoading } = useAdminPickers();
	const [sweepPool, setSweepPool] = useState("");
	const sweepPoolKey = toKey(sweepPool);
	const [gatePpm, setGatePpm] = useState("");
	const [treasuryInput, setTreasuryInput] = useState("");
	const treasuryKey = toKey(treasuryInput);
	const gateValue = gatePpm.trim() === "" ? null : Number(gatePpm);
	const gateValid =
		gateValue !== null &&
		Number.isInteger(gateValue) &&
		gateValue >= 0 &&
		gateValue <= 10_000;

	const [draft, setDraft] = useState<Partial<PauseFlags>>({});
	const [newAdmin, setNewAdmin] = useState("");
	const [transferConfirm, setTransferConfirm] = useState("");
	const [mintInput, setMintInput] = useState("");

	const mint = useMemo(() => toKey(mintInput), [mintInput]);
	const { data: policy } = useBribeTokenPolicy(mint);

	const current = config?.pauses;
	const flags = { ...current, ...draft } as PauseFlags;
	const rows: [keyof PauseFlags, string][] = [
		["global", i18n._("Everything (nuclear)")],
		["voting", i18n._("Voting")],
		["bribes", i18n._("Bribe deposits")],
		["claims", i18n._("Reward claims")],
		["exit", i18n._("Exit")],
		["gaugeActivation", i18n._("Gauge activation")],
		["emissions", i18n._("Emission funding")],
	];

	const isPendingAdmin =
		!!publicKey && config?.pendingAdmin === publicKey.toBase58();
	const newAdminKey = toKey(newAdmin);

	return (
		<Stack gap="lg">
			<CardLayout>
				<Stack gap="sm">
					<Text fz="lg" fw="bold">
						{i18n._("Pauses")}
					</Text>
					<Text fz="sm" c="gray">
						{i18n._(
							"Each switch stops only its own system. Swaps and liquidity are paused in the DEX program, not here.",
						)}
					</Text>
					{rows.map(([key, label]) => (
						<Switch
							key={key}
							label={label}
							checked={!!flags[key]}
							onChange={(e) =>
								setDraft({ ...draft, [key]: e.currentTarget.checked })
							}
						/>
					))}
					<Group>
						<Button
							loading={setPauses.isPending}
							disabled={!current || Object.keys(draft).length === 0}
							onClick={() => {
								setPauses.mutate(flags);
								setDraft({});
							}}
						>
							{i18n._("Apply pauses")}
						</Button>
						<Badge variant="light" color="yellow">
							{i18n._("{count} pending", { count: Object.keys(draft).length })}
						</Badge>
					</Group>
				</Stack>
			</CardLayout>

			<CardLayout>
				<Stack gap="sm">
					<Text fz="lg" fw="bold">
						{i18n._("Bribe tokens")}
					</Text>
					<Text fz="sm" c="gray">
						{i18n._(
							"Only allowed tokens can be deposited as bribes. Removing a token blocks new deposits only. Pausing a token also blocks claims of that token.",
						)}
					</Text>
					<Select
						label={i18n._("Token")}
						placeholder={pickersLoading ? i18n._("Loading tokens…") : i18n._("Select a token")}
						data={tokenOptions}
						value={tokenOptions.some((o) => o.value === mintInput) ? mintInput : null}
						onChange={(value) => setMintInput(value ?? "")}
						searchable
						clearable
						nothingFoundMessage={i18n._("No tokens found")}
					/>
					{mint ? (
						<Text fz="xs" c="gray">
							{policy
								? `${i18n._("Allowed")}: ${policy.allowed ? i18n._("yes") : i18n._("no")} · ${i18n._("Paused")}: ${policy.paused ? i18n._("yes") : i18n._("no")}`
								: i18n._("No policy set (not allowed)")}
						</Text>
					) : null}
					<Group>
						<Button
							disabled={!mint}
							loading={setBribeToken.isPending}
							onClick={() =>
								mint &&
								setBribeToken.mutate({ mint, allowed: true, paused: false })
							}
						>
							{i18n._("Allow")}
						</Button>
						<Button
							variant="default"
							disabled={!mint}
							loading={setBribeToken.isPending}
							onClick={() =>
								mint &&
								setBribeToken.mutate({ mint, allowed: false, paused: false })
							}
						>
							{i18n._("Remove")}
						</Button>
						<Button
							color="red"
							variant="light"
							disabled={!mint}
							loading={setBribeToken.isPending}
							onClick={() =>
								mint &&
								setBribeToken.mutate({ mint, allowed: false, paused: true })
							}
						>
							{i18n._("Pause token")}
						</Button>
					</Group>
				</Stack>
			</CardLayout>

			<CardLayout>
				<Stack gap="sm">
					<Text fz="lg" fw="bold">
						{i18n._("Activity gate")}
					</Text>
					<Text fz="sm" c="gray">
						{i18n._(
							"A pool earns emissions in an hour only if the previous hour's fees reached this share of its in-range liquidity value. Parts per million per hour: 100 = 1 basis point, 0 turns the gate off. Each gauge picks the new value up at its next funding.",
						)}
					</Text>
					<Text fz="xs" c="gray">
						{i18n._("Current")}:{" "}
						{config?.gatePpm === null || config?.gatePpm === undefined
							? i18n._("default (100)")
							: String(config.gatePpm)}
					</Text>
					<Group align="flex-end">
						<TextInput
							label={i18n._("Threshold (ppm per hour)")}
							value={gatePpm}
							onChange={(e) => setGatePpm(e.currentTarget.value)}
							error={gatePpm && !gateValid ? i18n._("0 to 10000") : null}
						/>
						<Button
							disabled={!gateValid}
							loading={setGate.isPending}
							onClick={() => gateValue !== null && setGate.mutate(gateValue)}
						>
							{i18n._("Set threshold")}
						</Button>
					</Group>
				</Stack>
			</CardLayout>

			<CardLayout>
				<Stack gap="sm">
					<Text fz="lg" fw="bold">
						{i18n._("Treasury")}
					</Text>
					<Text fz="sm" c="gray">
						{i18n._(
							"Bribes on gauges that received no votes are swept here once the epoch ends.",
						)}
					</Text>
					<Text fz="xs" c="gray">
						{i18n._("Current")}:{" "}
						{config?.treasury
							? formatAddress(config.treasury)
							: i18n._("Not set")}
					</Text>
					<TextInput
						label={i18n._("Treasury wallet")}
						value={treasuryInput}
						onChange={(e) => setTreasuryInput(e.currentTarget.value)}
						error={
							treasuryInput && !treasuryKey ? i18n._("Invalid address") : null
						}
					/>
					<Group>
						<Button
							variant="default"
							disabled={!publicKey}
							onClick={() => publicKey && setTreasuryInput(publicKey.toBase58())}
						>
							{i18n._("Use connected wallet")}
						</Button>
						<Button
							disabled={!treasuryKey}
							loading={setTreasury.isPending}
							onClick={() => treasuryKey && setTreasury.mutate(treasuryKey)}
						>
							{i18n._("Set treasury")}
						</Button>
					</Group>
					<Text fz="sm" c="gray">
						{i18n._(
							"Pools without an active gauge pay 5% of trading fees to the Treasury. Sweep a pool's share here; activating a gauge sweeps it automatically.",
						)}
					</Text>
					<Select
						label={i18n._("Pool")}
						placeholder={pickersLoading ? i18n._("Loading pools…") : i18n._("Select a pool without an active gauge")}
						data={ungaugedPoolOptions}
						value={ungaugedPoolOptions.some((o) => o.value === sweepPool) ? sweepPool : null}
						onChange={(value) => setSweepPool(value ?? "")}
						searchable
						clearable
						nothingFoundMessage={i18n._("No pools found")}
					/>
					<Group>
						<Button
							disabled={!sweepPoolKey}
							loading={sweepFees.isPending}
							onClick={() => sweepPoolKey && sweepFees.mutate(sweepPool.trim())}
						>
							{i18n._("Sweep pool fees")}
						</Button>
					</Group>
				</Stack>
			</CardLayout>

			<AdminPartnerVoters />

			<CardLayout>
				<Stack gap="sm">
					<Text fz="lg" fw="bold">
						{i18n._("Admin transfer")}
					</Text>
					<Text fz="sm" c="gray">
						{i18n._(
							"Two steps: the current Admin proposes a new wallet, then that wallet accepts. Cancel removes a pending proposal.",
						)}
					</Text>
					{config?.pendingAdmin ? (
						<Text fz="sm">
							{i18n._("Pending")}: {formatAddress(config.pendingAdmin)}
						</Text>
					) : null}
					<TextInput
						label={i18n._("New Admin wallet")}
						value={newAdmin}
						onChange={(e) => setNewAdmin(e.currentTarget.value)}
						error={newAdmin && !newAdminKey ? i18n._("Invalid address") : null}
					/>
					<TextInput
						label={i18n._("Type TRANSFER to confirm")}
						description={i18n._(
							"Admin transfer cannot be undone once the new wallet accepts. Check the address above first.",
						)}
						value={transferConfirm}
						onChange={(e) => setTransferConfirm(e.currentTarget.value)}
					/>
					<Group>
						<Button
							disabled={!newAdminKey || transferConfirm.trim() !== "TRANSFER"}
							loading={proposeAdmin.isPending}
							onClick={() => {
								if (!newAdminKey) return;
								proposeAdmin.mutate(newAdminKey);
								setTransferConfirm("");
							}}
						>
							{i18n._("Propose")}
						</Button>
						<Button
							variant="default"
							disabled={!config?.pendingAdmin}
							loading={proposeAdmin.isPending}
							onClick={() => proposeAdmin.mutate(PublicKey.default)}
						>
							{i18n._("Cancel proposal")}
						</Button>
						{isPendingAdmin && (
							<Button
							variant="default"
							disabled={!isPendingAdmin}
							loading={acceptAdmin.isPending}
							onClick={() => acceptAdmin.mutate(undefined)}
						>
							{i18n._("Accept (new Admin wallet)")}
						</Button>
						)}
					</Group>
				</Stack>
			</CardLayout>
		</Stack>
	);
};
