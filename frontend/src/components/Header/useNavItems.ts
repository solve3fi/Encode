import { useLingui } from "@lingui/react";
import {
	IconArrowsUpDown,
	IconBook2,
	IconCash,
	IconChecklist,
	IconCoin,
	IconDots,
	IconDroplet,
	IconFlag,
	IconGift,
	IconId,
	IconLock,
	IconParachute,
	IconPlayerPlay,
	IconPresentationAnalytics,
	IconRobot,
	IconRocket,
	IconSparkles,
	IconChartLine,
	IconTargetArrow,
} from "@tabler/icons-react";
import { usePathname } from "next/navigation";
import { AGENT_ENABLED } from "@/configs/agent";
import { GENESIS_PUBLIC_ENABLED } from "@/configs/genesis";
import { INTENTS_ENABLED } from "@/configs/intents";
import { DEX_ONLY } from "@/configs/launchPhase";
import { SALE_PAGE_ENABLED } from "@/configs/presaleSale";
import { ClusterNetwork, useCluster } from "@/providers/ClusterProvider";
import type { TablerIconsProps } from "@/types";

export interface INavbarItem {
	title: string;
	href: string;
	isActive?: boolean;
	description?: string;
	Icon?: TablerIconsProps;
	desktopOnly?: boolean;
	subItems?: INavbarItem[];
	disabled?: boolean;
	/** Gated during the DEX-only soft launch: listed, but not a link. */
	comingSoon?: boolean;
	/** In a dropdown, render this label above the item (starts a labelled section, e.g. "Beta"). */
	sectionLabel?: string;
	/** Small tag shown at the right of a link item, e.g. "Coming soon". */
	badge?: string;
}

/** Primary app navigation: Swap, Pools, Lock, Vote, Rewards, Quests, Pass, More. */
export const useNavItems = (): INavbarItem[] => {
	const { i18n } = useLingui();
	const pathname = usePathname();
	const { network } = useCluster();
	const active = (route: string) =>
		pathname.endsWith(route) || pathname.includes(`${route}/`);
	const gated = (route: string) =>
		DEX_ONLY
			? { comingSoon: true, isActive: false }
			: { isActive: active(route) };

	// The x402 agent runs on devnet only: a link there, "Coming soon" everywhere else (mainnet).
	const agentItem: INavbarItem = {
		title: i18n._("Agent"),
		href: "/beta/agent/intro",
		Icon: IconRobot,
		...(AGENT_ENABLED && network === ClusterNetwork.Devnet
			? { isActive: active("/beta/agent") }
			: { comingSoon: true, isActive: false }),
	};

	const core: INavbarItem[] = [
		{
			title: i18n._("Swap"),
			href: "/swap",
			Icon: IconArrowsUpDown,
			isActive: active("/swap"),
		},
		{
			title: i18n._("Pools"),
			href: "/liquidity",
			Icon: IconDroplet,
			isActive: active("/liquidity"),
		},
	];

	if (GENESIS_PUBLIC_ENABLED)
		return [
			...core,
			{
				title: i18n._("Quests"),
				href: "/quests",
				Icon: IconFlag,
				isActive: active("/quests"),
			},
			{
				title: i18n._("Genesis"),
				href: "/genesis",
				Icon: IconSparkles,
				isActive: active("/genesis"),
			},
			// Presale round 2 runs during the soft launch too (hidden until the sale page is enabled).
			...(SALE_PAGE_ENABLED
				? [
						{
							title: i18n._("Buy veSOLV3"),
							href: "/sale",
							Icon: IconCash,
							isActive: active("/sale"),
						},
					]
				: []),
			agentItem,
		];

	// The faucet exists only for devnet test tokens; it is not part of the mainnet menu.
	const showFaucet = network === ClusterNetwork.Devnet;
	const moreItems: INavbarItem[] = [
		{
			title: i18n._("Charter"),
			href: "/charter",
			Icon: IconBook2,
			isActive: active("/charter"),
		},
		// Cross-chain funding (Aurora Intents). Shown only when switched on; it moves real assets to Solana mainnet.
		...(INTENTS_ENABLED
			? [
					{
						title: i18n._("Fund from any chain"),
						href: "/fund",
						Icon: IconCash,
						isActive: active("/fund"),
					},
				]
			: []),
		{
			title: i18n._("Simulator"),
			href: "/simulator",
			Icon: IconPresentationAnalytics,
			...gated("/simulator"),
		},
		{
			title: i18n._("Bribes"),
			href: "/bribes",
			Icon: IconCoin,
			...gated("/bribes"),
		},
		{
			title: i18n._("Airdrop"),
			href: "/airdrop",
			Icon: IconParachute,
			...gated("/airdrop"),
		},
		{
			title: i18n._("Presale"),
			href: "/presale",
			Icon: IconRocket,
			...gated("/presale"),
		},
		// Presale round 2 is open in every launch phase once enabled; the claim page above stays gated until claims open.
		...(SALE_PAGE_ENABLED
			? [
					{
						title: i18n._("Buy veSOLV3"),
						href: "/sale",
						Icon: IconCash,
						isActive: active("/sale"),
					},
				]
			: []),
		...(showFaucet
			? [
					{
						title: i18n._("Devnet faucet"),
						href: "/devnet",
						Icon: IconPlayerPlay,
						...gated("/devnet"),
					},
				]
			: []),
		// Beta previews (informational, not live products): shown under a "Beta" label at the end of More.
		{
			title: i18n._("ALM"),
			href: "/beta/alm-market",
			Icon: IconChartLine,
			isActive: active("/beta/alm-market"),
			sectionLabel: i18n._("Beta"),
			badge: i18n._("Coming soon"),
		},
		{
			title: i18n._("Yield Hunter"),
			href: "/beta/yield-hunter",
			Icon: IconTargetArrow,
			isActive: active("/beta/yield-hunter"),
			badge: i18n._("Coming soon"),
		},
	];

	return [
		...core,
		{
			title: i18n._("Lock"),
			href: "/lock",
			Icon: IconLock,
			...gated("/lock"),
		},
		{
			title: i18n._("Vote"),
			href: "/vote",
			Icon: IconChecklist,
			...gated("/vote"),
		},
		{
			title: i18n._("Rewards"),
			href: "/rewards",
			Icon: IconGift,
			...gated("/rewards"),
		},
		{
			title: i18n._("Quests & Pass"),
			href: "/quests",
			Icon: IconFlag,
			isActive: active("/quests"),
		},
		agentItem,
		{
			title: i18n._("More"),
			href: "/charter",
			Icon: IconDots,
			isActive: moreItems.some((item) => item.isActive),
			subItems: moreItems,
		},
	];
};
