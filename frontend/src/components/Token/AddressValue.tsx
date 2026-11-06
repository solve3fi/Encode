"use client";

import { CopyButton, Tooltip, UnstyledButton } from "@mantine/core";
import { formatAddress } from "@/lib/format";
import classes from "./AddressValue.module.css";

export const AddressValue = ({ address, label }: { address: string; label?: string }) => (
	<CopyButton value={address} timeout={1400}>
		{({ copied, copy }) => (
			<Tooltip label={address} withArrow>
				<UnstyledButton className={classes.address} onClick={copy} aria-label={`Copy ${label || "address"} ${address}`}>
					<span>{formatAddress(address)}</span>
					{copied ? <span className={classes.confirmation}>Copied</span> : null}
				</UnstyledButton>
			</Tooltip>
		)}
	</CopyButton>
);
