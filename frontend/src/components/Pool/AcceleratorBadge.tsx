import { useLingui } from "@lingui/react";
import { ThemeIcon, Tooltip } from "@mantine/core";
import { IconRocket } from "@tabler/icons-react";
import type { AcceleratedPoolInfo } from "@/hooks/useAcceleratedPools";

export type AcceleratorBadgeProps = {
	info: AcceleratedPoolInfo;
};

// Shown only while a pool is an active, not-yet-expired Accelerator Program
// partner (see useAcceleratedPools) — disappears on its own once the
// partner's epoch window closes or an admin marks it completed/removed.
export const AcceleratorBadge: React.FC<AcceleratorBadgeProps> = ({ info }) => {
	const { i18n } = useLingui();

	return (
		<Tooltip
			label={i18n._(
				"Accelerator Program partner ({project}) — {epochs} epoch(s) of boosted votes remaining",
				{
					project: info.projectName,
					epochs: info.epochsRemaining,
				},
			)}
			withArrow
		>
			<ThemeIcon size={18} radius="xl" color="violet" variant="light">
				<IconRocket size={12} stroke={2.2} />
			</ThemeIcon>
		</Tooltip>
	);
};
