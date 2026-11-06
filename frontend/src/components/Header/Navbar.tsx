import classes from "./Header.module.css";
import { NavItem } from "./NavItem";
import { useNavItems } from "./useNavItems";

export const Navbar: React.FC = () => {
	const navigationItems = useNavItems();
	return (
		<div className={classes.links}>
			{navigationItems.map((item) => (
				<NavItem key={item.title} {...item} />
			))}
		</div>
	);
};
