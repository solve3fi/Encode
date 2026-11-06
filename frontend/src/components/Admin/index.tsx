"use client";

import { useLingui } from "@lingui/react";
import { Center, Stack, Text } from "@mantine/core";
import { useWallet } from "@solana/wallet-adapter-react";
import { useEffect, useState } from "react";
import { usePartnerOnboarding } from "@/hooks/usePartnerOnboarding";
import { useProtocolAdmin } from "@/hooks/useProtocolAdmin";
import { formatAddress } from "@/lib/format";
import { CardLayout } from "../Layout/CardLayout";
import classes from "./Admin.module.css";
import { AdminAcceleratorProgram } from "./AdminAcceleratorProgram";
import { AdminAddGauge } from "./AdminAddGauge";
import { AdminAirdropStats } from "./AdminAirdropStats";
import { AdminAllocationVotes } from "./AdminAllocationVotes";
import { AdminAutoVoteWallets } from "./AdminAutoVoteWallets";
import { AdminEmissionsChart } from "./AdminEmissionsChart";
import { AdminBribeRecovery } from "./AdminBribeRecovery";
import { AdminExitFee } from "./AdminExitFee";
import { AdminGaugeMove } from "./AdminGaugeMove";
import { AdminExitPrice } from "./AdminExitPrice";
import { AdminFeeTiers } from "./AdminFeeTiers";
import { AdminGaugeStatus } from "./AdminGaugeStatus";
import { AdminLaunchLadder } from "./AdminLaunchLadder";
import { AdminLockStats } from "./AdminLockStats";
import { AdminLpIncentives } from "./AdminLpIncentives";
import { AdminPartnerApplications } from "./AdminPartnerApplications";
import { AdminPartnerOnboarding } from "./AdminPartnerOnboarding";
import { AdminPartnerSpaces } from "./AdminPartnerSpaces";
import { AdminPresaleSale } from "./AdminPresaleSale";
import { AdminProtocolControls } from "./AdminProtocolControls";
import { AdminQuestControls } from "./AdminQuestControls";
import { AdminQuests } from "./AdminQuests";
import { AdminTabBoundary } from "./AdminTabBoundary";
import { AdminTokenLinks } from "./AdminTokenLinks";
import { AdminTokenomics } from "./AdminTokenomics";
import { AdminTokenRequests } from "./AdminTokenRequests";
import { AdminWalletLookup } from "./AdminWalletLookup";

const GROUPS = [
	{
		label: "Overview",
		items: [
			["locks", "Locks"],
			["wallet-lookup", "Wallet lookup"],
			["tokenomics", "Tokenomics"],
		],
	},
	{
		label: "Rewards & emissions",
		items: [
			["emissions", "Emissions"],
			["exit-price", "Exit price & fee"],
			["lp-incentives", "LP incentives"],
			["airdrop", "Airdrop"],
			["presale", "Presale"],
		],
	},
	{
		label: "Protocol",
		items: [
			["controls", "Controls"],
			["add-gauge", "Add gauge"],
			["bribe-recovery", "Bribe recovery"],
			["fee-tiers", "Fee tiers"],
			["auto-vote", "Auto-vote wallets"],
			["accelerator", "Accelerator"],
			["launch", "Launch"],
			["quest-controls", "Quest controls"],
			["quests", "Quests"],
		],
	},
	{
		label: "Listings & partners",
		items: [
			["token-links", "Token links"],
			["token-requests", "Token requests"],
			["partner-onboarding", "Partner onboarding"],
			["partner-applications", "Partner applications"],
			["partner-spaces", "Partner spaces"],
		],
	},
] as const;

type AdminTab = (typeof GROUPS)[number]["items"][number][0];
const ADMIN_TABS: AdminTab[] = GROUPS.flatMap((group) =>
	group.items.map(([id]) => id),
);
const LABELS = Object.fromEntries(
	GROUPS.flatMap((group) => group.items.map(([id, label]) => [id, label])),
) as Record<AdminTab, string>;

// The section lives in the URL hash (/admin#launch) so a link opens it directly;
// the hash is only readable after mount.
const tabFromHash = (): AdminTab => {
	const hash =
		typeof window !== "undefined"
			? window.location.hash.slice(1).split("?")[0]
			: "";
	return (ADMIN_TABS as string[]).includes(hash)
		? (hash as AdminTab)
		: ADMIN_TABS[0];
};

const renderSection = (
	tab: AdminTab,
	go: (tab: AdminTab, query?: string) => void,
) => {
	switch (tab) {
		case "locks":
			return <AdminLockStats />;
		case "wallet-lookup":
			return <AdminWalletLookup />;
		case "tokenomics":
			return <AdminTokenomics />;
		case "emissions":
			return <AdminEmissionsChart />;
		case "exit-price":
			return (
				<Stack gap="lg">
					<AdminExitPrice />
					<AdminExitFee />
				</Stack>
			);
		case "lp-incentives":
			return <AdminLpIncentives />;
		case "airdrop":
			return <AdminAirdropStats />;
		case "presale":
			return <AdminPresaleSale />;
		case "controls":
			return <AdminProtocolControls />;
		case "add-gauge":
			return (
				<Stack gap="lg">
					<AdminAddGauge />
					<AdminGaugeMove />
					<AdminGaugeStatus />
				</Stack>
			);
		case "bribe-recovery":
			return <AdminBribeRecovery />;
		case "fee-tiers":
			return <AdminFeeTiers />;
		case "auto-vote":
			return (
				<Stack gap="lg">
					<AdminAutoVoteWallets />
					<AdminAllocationVotes />
				</Stack>
			);
		case "accelerator":
			return <AdminAcceleratorProgram />;
		case "launch":
			return <AdminLaunchLadder />;
		case "token-links":
			return <AdminTokenLinks />;
		case "token-requests":
			return <AdminTokenRequests />;
		case "partner-applications":
			return <AdminPartnerApplications />;
		case "partner-onboarding":
			return <AdminPartnerOnboarding onNavigate={go} />;
		case "partner-spaces":
			return <AdminPartnerSpaces />;
		case "quest-controls":
			return <AdminQuestControls />;
		case "quests":
			return <AdminQuests />;
	}
};

export const Admin: React.FC = () => {
	const { i18n } = useLingui();
	const { connected } = useWallet();
	const { isAdmin, isLoading } = useProtocolAdmin();

	if (!connected) {
		return (
			<CardLayout>
				<Center py="xl">
					<Text c="gray">{i18n._("Connect Wallet")}</Text>
				</Center>
			</CardLayout>
		);
	}

	if (isLoading) {
		return (
			<CardLayout>
				<Center py="xl">
					<Text c="gray">{i18n._("Loading…")}</Text>
				</Center>
			</CardLayout>
		);
	}

	if (!isAdmin) {
		return (
			<CardLayout>
				<Center py="xl">
					<Stack gap={4} ta="center">
						<Text fw="bold">{i18n._("Not authorized")}</Text>
						<Text c="gray" fz="sm">
							{i18n._("Only vesolve's admin wallets can access this page.")}
						</Text>
					</Stack>
				</Center>
			</CardLayout>
		);
	}

	return <AdminConsole />;
};

// Only rendered for an admin wallet, so the onboarding data is never fetched for anyone else.
const AdminConsole: React.FC = () => {
	const { i18n } = useLingui();
	const { publicKey } = useWallet();
	const onboarding = usePartnerOnboarding();
	const [tab, setTab] = useState<AdminTab>(ADMIN_TABS[0]);

	useEffect(() => {
		setTab(tabFromHash());
		const onHash = () => setTab(tabFromHash());
		window.addEventListener("hashchange", onHash);
		return () => window.removeEventListener("hashchange", onHash);
	}, []);

	const select = (next: AdminTab, query?: string) => {
		setTab(next);
		window.history.replaceState(
			null,
			"",
			`#${next}${query ? `?${query}` : ""}`,
		);
	};

	return (
		<div className={classes.page}>
			<header className={classes.head}>
				<div className={classes.headText}>
					<span className={classes.pill}>{i18n._("Admin only")}</span>
					<h1>{i18n._("Admin")}</h1>
					<p>
						{i18n._(
							"Protocol controls for Solve3. Every write needs a signature from an admin wallet.",
						)}
					</p>
				</div>
				{publicKey && (
					<div className={classes.signed}>
						<i aria-hidden="true" />
						{i18n._("Signed in as")}{" "}
						<strong>{formatAddress(publicKey.toBase58())}</strong>
					</div>
				)}
			</header>

			{onboarding.actionCount > 0 && tab !== "partner-onboarding" && (
				<button
					type="button"
					className={classes.reminder}
					onClick={() => select("partner-onboarding")}
				>
					<strong>
						{onboarding.actionCount}{" "}
						{onboarding.actionCount === 1 ? "partner needs" : "partners need"}{" "}
						you
					</strong>
					<span>Open the onboarding checklist →</span>
				</button>
			)}

			<nav className={classes.chips} aria-label={i18n._("Admin sections")}>
				{ADMIN_TABS.map((id) => (
					<button
						key={id}
						type="button"
						className={classes.chip}
						aria-current={tab === id ? "page" : undefined}
						onClick={() => select(id)}
					>
						{i18n._(LABELS[id])}
						{id === "partner-onboarding" && onboarding.actionCount > 0 && (
							<span className={classes.count}>{onboarding.actionCount}</span>
						)}
					</button>
				))}
			</nav>

			<div className={classes.layout}>
				<nav className={classes.sidebar} aria-label={i18n._("Admin sections")}>
					{GROUPS.map((group) => (
						<div key={group.label} className={classes.group}>
							<span className={classes.groupLabel}>{i18n._(group.label)}</span>
							{group.items.map(([id, label]) => (
								<button
									key={id}
									type="button"
									className={classes.item}
									aria-current={tab === id ? "page" : undefined}
									onClick={() => select(id)}
								>
									{i18n._(label)}
									{id === "partner-onboarding" &&
										onboarding.actionCount > 0 && (
											<span className={classes.count}>
												{onboarding.actionCount}
											</span>
										)}
								</button>
							))}
						</div>
					))}
				</nav>
				<main className={classes.content}>
					<AdminTabBoundary key={tab} name={LABELS[tab]}>
						{renderSection(tab, select)}
					</AdminTabBoundary>
				</main>
			</div>
		</div>
	);
};
