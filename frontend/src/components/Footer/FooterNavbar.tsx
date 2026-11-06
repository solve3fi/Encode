"use client";

import { Menu } from "@mantine/core";
import Link from "next/link";
import { ComingSoonBadge } from "../ComingSoon/ComingSoonBadge";
import { useNavItems } from "../Header/useNavItems";
import classes from "./FooterNavbar.module.css";

/** Fixed bottom tab bar shown at 760px and below. */
export const FooterNavbar: React.FC = () => {
	const items = useNavItems();
	return (
		<nav
			className={classes.bar}
			aria-label="Primary"
			style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}
		>
			{items.map((item) => {
				const Icon = item.Icon;
				const content = (
					<>
						{Icon && <Icon size={22} stroke={1.8} />}
						<span>{item.title}</span>
					</>
				);
				if (item.subItems) {
					return (
						<Menu
							key={item.title}
							trigger="click"
							position="top-end"
							offset={14}
							withinPortal
							classNames={{ dropdown: classes.dropdown, item: classes.dropdownItem }}
						>
							<Menu.Target>
								<button
									type="button"
									className={`${classes.tab} ${item.isActive ? classes.on : ""}`}
								>
									{content}
								</button>
							</Menu.Target>
							<Menu.Dropdown>
								{item.subItems.map((sub) =>
									sub.comingSoon ? (
										<Menu.Item
											key={sub.title}
											disabled
											aria-disabled
											leftSection={
												sub.Icon ? <sub.Icon size={20} stroke={1.8} /> : undefined
											}
											rightSection={<ComingSoonBadge short />}
										>
											{sub.title}
										</Menu.Item>
									) : (
									<Menu.Item
										key={sub.title}
										component={Link}
										href={sub.href}
										data-active={sub.isActive || undefined}
										leftSection={
											sub.Icon ? <sub.Icon size={20} stroke={1.8} /> : undefined
										}
									>
										{sub.title}
									</Menu.Item>
									),
								)}
							</Menu.Dropdown>
						</Menu>
					);
				}
				if (item.comingSoon) {
					// Keeps its tab slot so the bar does not reflow; not a link.
					return (
						<span key={item.title} className={`${classes.tab} ${classes.soon}`} aria-disabled="true">
							{content}
						</span>
					);
				}
				return (
					<Link
						key={item.title}
						href={item.href}
						className={`${classes.tab} ${item.isActive ? classes.on : ""}`}
						aria-current={item.isActive ? "page" : undefined}
					>
						{content}
					</Link>
				);
			})}
		</nav>
	);
};
