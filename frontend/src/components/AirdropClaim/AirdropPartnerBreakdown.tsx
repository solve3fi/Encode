import { useLingui } from "@lingui/react";
import { Avatar, Group, Stack, Text } from "@mantine/core";
import { AIRDROP_TOKEN_DECIMALS, AIRDROP_TOKEN_SYMBOL } from "@/configs/airdrop";
import { AIRDROP_PARTNER_META } from "@/configs/airdropPartners";
import { formatTokenAmount } from "@/lib/format";

export type AirdropPartnerBreakdownProps = {
	partnerAmountsRaw?: Record<string, string>;
};

const toWhole = (raw: string) => Number(raw) / 10 ** AIRDROP_TOKEN_DECIMALS;

/** Shows which partner campaigns (Aerodrome, Equalizer, etc.) contributed to
 * a wallet's total allocation — partnerAmountsRaw comes straight from
 * AirdropAllocation (src/configs/airdropTypes.ts), keyed by AIRDROP_PARTNERS. */
export const AirdropPartnerBreakdown: React.FC<AirdropPartnerBreakdownProps> = ({
	partnerAmountsRaw,
}) => {
	const { i18n } = useLingui();
	const entries = Object.entries(partnerAmountsRaw ?? {})
		.filter(([partner]) => partner in AIRDROP_PARTNER_META)
		.sort(([, a], [, b]) => (BigInt(a) < BigInt(b) ? 1 : BigInt(a) > BigInt(b) ? -1 : 0));

	if (entries.length === 0) return null;

	return (
		<Stack gap={6} w="100%">
			<Text fz="xs" c="gray" tt="uppercase" fw={600}>
				{i18n._("Where this came from")}
			</Text>
			{entries.map(([partner, raw]) => {
				const meta = AIRDROP_PARTNER_META[partner];
				return (
					<Group key={partner} justify="space-between" wrap="nowrap">
						<Group gap={8} wrap="nowrap">
							<Avatar src={meta.logo} size={20} radius="sm" />
							<Text fz="sm">{meta.label}</Text>
						</Group>
						<Text fz="sm" fw={600} data-numeric="true">
							{formatTokenAmount(toWhole(raw), { decimals: AIRDROP_TOKEN_DECIMALS })}{" "}
							{AIRDROP_TOKEN_SYMBOL}
						</Text>
					</Group>
				);
			})}
		</Stack>
	);
};
