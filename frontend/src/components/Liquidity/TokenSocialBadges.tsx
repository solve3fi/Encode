import { useLingui } from "@lingui/react";
import { Group, Tooltip, UnstyledButton } from "@mantine/core";
import type { TokenInfo } from "@solana/spl-token-registry";
import { IconBrandX, IconCircleCheck, IconWorld } from "@tabler/icons-react";
import { useTokenLinkOverrides } from "@/hooks/useToken";

export type TokenSocialBadgesProps = {
	token?: TokenInfo | null;
};

// Website/X links plus a placeholder "verified" badge for a future real
// security check — shown only for tokens that resolved to real registry
// data (official or community-approved via /api/token-list-extra), not the
// truncated-address fallback used for unrecognized pairs. Admin-set
// overrides (src/components/Admin/AdminTokenLinks.tsx) are merged in here,
// scoped to this component, rather than in useAllTokens()/useToken() — that
// hook fires many times per render across the whole app (once per resolved
// token on every pool row), and adding a hook there broke React's hook-order
// invariant across LiquidityDataWrapper's renders.
export const TokenSocialBadges: React.FC<TokenSocialBadgesProps> = ({
	token,
}) => {
	const { i18n } = useLingui();
	const overrides = useTokenLinkOverrides();
	if (!token) return null;

	const override = overrides[token.address];
	const website = override?.website ?? token.extensions?.website;
	const twitter = override?.twitter ?? token.extensions?.twitter;

	return (
		<Group gap={6} wrap="nowrap">
			{website && (
				<Tooltip label={i18n._("Website")}>
					<UnstyledButton
						component="a"
						href={website}
						target="_blank"
						rel="noreferrer noopener"
						c="gray"
						onClick={(event) => event.stopPropagation()}
					>
						<IconWorld size={14} />
					</UnstyledButton>
				</Tooltip>
			)}
			{twitter && (
				<Tooltip label={i18n._("X (Twitter)")}>
					<UnstyledButton
						component="a"
						href={twitter}
						target="_blank"
						rel="noreferrer noopener"
						c="gray"
						onClick={(event) => event.stopPropagation()}
					>
						<IconBrandX size={14} />
					</UnstyledButton>
				</Tooltip>
			)}
			<Tooltip label={i18n._("Security check coming soon")}>
				<IconCircleCheck size={14} color="var(--mantine-color-teal-6)" />
			</Tooltip>
		</Group>
	);
};
