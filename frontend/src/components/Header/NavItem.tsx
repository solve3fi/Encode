import { Menu } from "@mantine/core";
import { IconChevronDown } from "@tabler/icons-react";
import Link from "next/link";
import { Fragment } from "react";
import { ComingSoonBadge } from "../ComingSoon/ComingSoonBadge";
import classes from "./Header.module.css";
import type { INavbarItem } from "./useNavItems";

export const NavItem: React.FC<INavbarItem> = ({
	href,
	title,
	subItems,
	isActive,
	comingSoon,
}) =>
	subItems ? (
		<Menu
			trigger="click"
			position="bottom-end"
			offset={6}
			withinPortal
			transitionProps={{ transition: "pop", duration: 120 }}
			classNames={{ dropdown: classes.dropdown, item: classes.dropdownItem }}
		>
			<Menu.Target>
				<button
					type="button"
					className={`${classes.moreButton} ${isActive ? classes.active : ""}`}
				>
					{title}
					<IconChevronDown size={14} stroke={2.4} />
				</button>
			</Menu.Target>
			<Menu.Dropdown>
				{subItems.map((item) =>
					item.comingSoon ? (
						// Not a link: gated during the DEX-only soft launch.
						<Menu.Item
							key={item.title}
							disabled
							aria-disabled
							leftSection={
								item.Icon ? <item.Icon size={20} stroke={1.8} /> : undefined
							}
							rightSection={<ComingSoonBadge short />}
						>
							{item.title}
						</Menu.Item>
					) : (
					<Fragment key={item.title}>
						{item.sectionLabel ? (
							<>
								<Menu.Divider />
								<Menu.Label>{item.sectionLabel}</Menu.Label>
							</>
						) : null}
						<Menu.Item
							component={Link}
							href={item.href}
							data-active={item.isActive || undefined}
							aria-current={item.isActive ? "page" : undefined}
							leftSection={
								item.Icon ? <item.Icon size={20} stroke={1.8} /> : undefined
							}
							rightSection={
								item.badge ? (
									<span style={{ fontSize: 11, opacity: 0.7 }}>{item.badge}</span>
								) : undefined
							}
						>
							{item.title}
						</Menu.Item>
					</Fragment>
					),
				)}
			</Menu.Dropdown>
		</Menu>
	) : comingSoon ? (
		<span className={classes.soon} aria-disabled="true">
			{title}
			<ComingSoonBadge short />
		</span>
	) : (
		<Link
			href={href}
			className={isActive ? classes.active : undefined}
			aria-current={isActive ? "page" : undefined}
		>
			{title}
		</Link>
	);
