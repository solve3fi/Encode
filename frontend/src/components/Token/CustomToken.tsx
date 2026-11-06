import { useLingui } from "@lingui/react";
import { Center, Loader, Text } from "@mantine/core";
import type { TokenInfo } from "@solana/spl-token-registry";
import { useToken } from "@/hooks/useToken";
import { TokenList } from "./TokenList";

export type CustomTokenProps = {
	address: string;
	handleSelectToken: (token: TokenInfo) => void;
	isTokenAllowed?: (token: TokenInfo) => boolean;
};

export const CustomToken: React.FC<CustomTokenProps> = ({
	address,
	handleSelectToken,
	isTokenAllowed = () => true,
}) => {
	const { i18n } = useLingui();
	// useToken already falls back to an on-chain mint lookup for an address
	// that isn't on any known list -- undefined here means that lookup is
	// still in flight, null/never-set means it genuinely isn't a valid mint.
	const token = useToken(address);

	if (token) {
		if (!isTokenAllowed(token)) {
			return (
				<Center>
					<Text c="gray.10">Unavailable during Genesis</Text>
				</Center>
			);
		}
		return (
			<TokenList
				key={token.address}
				token={token}
				onSelected={handleSelectToken}
			/>
		);
	}

	if (token === undefined) {
		return (
			<Center>
				<Loader size="sm" />
			</Center>
		);
	}

	return (
		<Center>
			<Text c="gray.10">{i18n._("Token not found!")}</Text>
		</Center>
	);
};
