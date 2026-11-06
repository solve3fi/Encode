import { Button } from "@mantine/core";
import type { ReactNode } from "react";
import classes from "./DataState.module.css";

type DataStateProps = {
	kind: "loading" | "empty" | "error";
	title: string;
	description: string;
	actionLabel?: string;
	onAction?: () => void;
	icon?: ReactNode;
};

export const DataState: React.FC<DataStateProps> = ({
	kind,
	title,
	description,
	actionLabel,
	onAction,
	icon,
}) => (
	<div className={classes.root} data-kind={kind} role={kind === "error" ? "alert" : "status"}>
		<div className={classes.signal} aria-hidden="true">
			{icon ?? <span className={classes.orbit} />}
		</div>
		<div>
			<div className={classes.title}>{title}</div>
			<p className={classes.description}>{description}</p>
		</div>
		{actionLabel && onAction ? (
			<Button variant="light" size="xs" onClick={onAction}>
				{actionLabel}
			</Button>
		) : null}
	</div>
);
