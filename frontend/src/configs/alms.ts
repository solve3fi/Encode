import type { TokenInfo } from "@solana/spl-token-registry";

export type ALMInfo = {
	name: string;
	url: string;
	logo: string;
	description: string;
	address: string;
	apr: number;
	aprToken?: TokenInfo;
};

export const ALMS: ALMInfo[] = [
	{
		name: "Kamino",
		url: "https://app.kamino.finance/",
		logo: "https://app.kamino.finance/assets/logo-f4FieaHQ.svg",
		description:
			"Kamino is a decentralized protocol that enables the creation of synthetic assets on Solana.",
		address: "6LtLpnUFNByNXLyCoK9wA2MykKAmQNZKBdY8s47dehDc",
		apr: 41.45,
		aprToken: {
			chainId: 16600,
			address: "0x9A87C2412d500343c073E5Ae5394E3bE3874F76b",
			symbol: "USDT",
			name: "USDT",
			decimals: 9,
			logoURI: "https://app.kamino.finance/assets/tokens/USDT.png",
		},
	},
];
