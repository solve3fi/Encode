"use client";

import { Image as MantineImage } from "@mantine/core";
import { IconArrowUpRight } from "@tabler/icons-react";
import Image from "next/image";
import Link from "next/link";
import { GENESIS_PUBLIC_ENABLED } from "@/configs/genesis";
import { DEX_ONLY } from "@/configs/launchPhase";
import { CommandBar } from "../CommandBar";
import { EpochClock } from "../EpochClock";
import { WalletConnect } from "../Wallet";
import classes from "./Header.module.css";
import { Navbar } from "./Navbar";

export type HeaderVariant = "marketing" | "app";

export type MarketingCta = { label: string; href: string };

const MARKETING_LINKS: ReadonlyArray<readonly [string, string]> = [
	["Swap", "/swap"],
	["Arena", "/arena"],
	["Quests", "/quests"],
	["Wallet", "/rewards"],
	["Partners", "/partners"],
];

const GENESIS_MARKETING_LINKS: ReadonlyArray<readonly [string, string]> = [
	["Swap", "/swap"],
	["Pools", "/liquidity"],
	["Quests", "/quests"],
	["Genesis", "/genesis"],
];

export const Header: React.FC<{
	variant?: HeaderVariant;
	cta?: MarketingCta;
}> = ({ variant = "app", cta = { label: "Open app", href: "/swap" } }) => {
	const marketing = variant === "marketing";
	const links = GENESIS_PUBLIC_ENABLED
		? GENESIS_MARKETING_LINKS
		: MARKETING_LINKS;
	return (
		<header className={`${classes.root} ${marketing ? classes.marketing : ""}`}>
			<nav className={classes.bar} aria-label={marketing ? "Primary" : "App"}>
				<div className={classes.left}>
					<Link href="/" className={classes.brand} aria-label="Solve3 home">
						<Image
							src="/assets/images/solve-logo.svg"
							width={110}
							height={30}
							alt="Solve3"
							priority={marketing}
						/>
					</Link>
					{marketing ? (
						<div className={classes.marketingLinks}>
							{links.map(([label, href]) => (
								<Link key={href + label} href={href}>
									{label}
								</Link>
							))}
						</div>
					) : (
						<Navbar />
					)}
				</div>
				<div className={classes.controls}>
					{marketing ? (
						<>
							<CommandBar />
							<Link href={cta.href} className={classes.cta}>
								{cta.label} <IconArrowUpRight size={17} stroke={1.8} />
							</Link>
						</>
					) : (
						<>
							{!GENESIS_PUBLIC_ENABLED && !DEX_ONLY && (
								<div className={classes.epochRow}>
									<EpochClock variant="bar" />
									<Link href="/#this-epoch">This epoch</Link>
								</div>
							)}
							<span className={classes.chain}>
								<span className={classes.chainDot} />
								Solana
							</span>
							<span
								className={`${classes.chain} ${classes.mobileChain}`}
								role="img"
								aria-label="Solana"
								title="Solana"
							>
								<MantineImage
									src="/assets/tokens/sol.svg"
									alt=""
									w={20}
									h={20}
								/>
							</span>
							<CommandBar />
							<WalletConnect />
						</>
					)}
				</div>
			</nav>
		</header>
	);
};
