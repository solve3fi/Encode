import type { ReactNode } from "react";
import classes from "./StatusChip.module.css";

export type StatusTone =
	| "live"
	| "devnet"
	| "snapshot"
	| "pending"
	| "success"
	| "error"
	| "neutral";

type StatusChipProps = {
	children: ReactNode;
	tone?: StatusTone;
	pulse?: boolean;
	className?: string;
};

export const StatusChip: React.FC<StatusChipProps> = ({
	children,
	tone = "neutral",
	pulse = false,
	className,
}) => (
	<span
		className={[classes.root, classes[tone], className].filter(Boolean).join(" ")}
		data-numeric="true"
	>
		<span
			className={[classes.dot, pulse ? classes.pulse : ""].filter(Boolean).join(" ")}
			aria-hidden="true"
		/>
		{children}
	</span>
);
