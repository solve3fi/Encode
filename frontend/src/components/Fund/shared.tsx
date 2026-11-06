"use client";

import { IconCheck, IconCopy } from "@tabler/icons-react";
import { useState } from "react";
import type { IntentsChain } from "@/lib/intents/chains";
import classes from "./Fund.module.css";

export const CopyButton: React.FC<{ value: string; label: string }> = ({
	value,
	label,
}) => {
	const [done, setDone] = useState(false);
	return (
		<button
			type="button"
			className={classes.ghost}
			aria-label={label}
			onClick={async () => {
				try {
					await navigator.clipboard.writeText(value);
					setDone(true);
					window.setTimeout(() => setDone(false), 1800);
				} catch {
					/* the address is also selectable text */
				}
			}}
		>
			{done ? (
				<IconCheck size={16} stroke={2} />
			) : (
				<IconCopy size={16} stroke={1.8} />
			)}
			{done ? "Copied" : "Copy"}
		</button>
	);
};

export const ChainChips: React.FC<{
	chains: readonly IntentsChain[];
	value: string;
	onChange: (slug: string) => void;
	label: string;
}> = ({ chains, value, onChange, label }) => (
	<div className={classes.chips} role="radiogroup" aria-label={label}>
		{chains.map((chain) => (
			// biome-ignore lint/a11y/useSemanticElements: a styled chip group; each chip is a button with role radio
			<button
				key={chain.slug}
				type="button"
				role="radio"
				aria-checked={value === chain.slug}
				className={classes.chip}
				onClick={() => onChange(chain.slug)}
			>
				{chain.label}
			</button>
		))}
	</div>
);

export const short = (value: string, head = 8, tail = 6) =>
	value.length > head + tail + 1
		? `${value.slice(0, head)}…${value.slice(-tail)}`
		: value;
