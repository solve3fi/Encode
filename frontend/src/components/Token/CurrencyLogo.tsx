import { Avatar, type AvatarProps } from "@mantine/core";
import type { TokenInfo } from "@solana/spl-token-registry";

const isTokenInfo = (
	token: TokenInfo | undefined | null,
): token is TokenInfo => {
	return !!token && "logoURI" in token && "address" in token;
};

export const CurrencyLogo = ({
	currency,
	...props
}: {
	currency?: TokenInfo | null;
} & Omit<AvatarProps, "src">) => {
	const uri = currency && isTokenInfo(currency) ? currency.logoURI : undefined;

	const src =
		uri ??
		(currency?.symbol
			? `/assets/tokens/${currency.symbol.toLowerCase()}.png`
			: "/assets/tokens/solv3.png");

	return <Avatar src={src} size={24} {...props} />;
};
