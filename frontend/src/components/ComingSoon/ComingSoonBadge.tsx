import classes from "./ComingSoonBadge.module.css";

type ComingSoonBadgeProps = {
	/** Short form ("Soon") fits nav rows; the long form suits section headings. */
	short?: boolean;
	className?: string;
};

// Inline "Coming soon" marker used wherever a gated ve feature is still shown
// during the DEX-only soft launch (nav items, landing-page cards).
export const ComingSoonBadge: React.FC<ComingSoonBadgeProps> = ({
	short = false,
	className,
}) => (
	<span
		className={[classes.root, className].filter(Boolean).join(" ")}
		title={short ? "Coming soon" : undefined}
	>
		{short ? "Soon" : "Coming soon"}
	</span>
);
