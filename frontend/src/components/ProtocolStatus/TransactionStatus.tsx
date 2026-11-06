import { Anchor } from "@mantine/core";
import { IconExternalLink } from "@tabler/icons-react";
import { StatusChip, type StatusTone } from "./StatusChip";
import classes from "./TransactionStatus.module.css";

type TransactionStatusProps = {
	status: "pending" | "success" | "error";
	title: string;
	description: string;
	signature?: string;
	explorerUrl?: string;
	details?: string;
};

const toneByStatus: Record<TransactionStatusProps["status"], StatusTone> = {
	pending: "pending",
	success: "success",
	error: "error",
};

export const TransactionStatus: React.FC<TransactionStatusProps> = ({
	status,
	title,
	description,
	signature,
	explorerUrl,
	details,
}) => (
	<div className={classes.root} data-status={status} role={status === "error" ? "alert" : "status"}>
		<div className={classes.header}>
			<StatusChip tone={toneByStatus[status]} pulse={status === "pending"}>
				{status === "pending" ? "Awaiting chain" : status}
			</StatusChip>
			<span className={classes.line} aria-hidden="true" />
		</div>
		<strong className={classes.title}>{title}</strong>
		<p className={classes.description}>{description}</p>
		{signature ? (
			<code className={classes.signature} title={signature}>
				{signature.slice(0, 8)}…{signature.slice(-8)}
			</code>
		) : null}
		{details ? <details className={classes.details}><summary>Technical details</summary><code>{details}</code></details> : null}
		{explorerUrl ? (
			<Anchor href={explorerUrl} target="_blank" rel="noopener noreferrer" className={classes.link}>
				Verify on Solscan <IconExternalLink size={14} aria-hidden="true" />
			</Anchor>
		) : null}
	</div>
);
