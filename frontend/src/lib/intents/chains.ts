/**
 * Source chains offered in the UI. Aurora's persistent-address API accepts these deposit chains (docs:
 * create-persistent-deposit-address). The Swap API supports more; the list can grow without changing the flow.
 */
export type IntentsChain = {
	/** Aurora slug sent to the API. */
	slug: string;
	label: string;
	/** Words a person might type ("ethereum", "eth", "mainnet"). */
	aliases: string[];
	/** Network the user must send on, shown next to every address. */
	network: string;
	/** A deposit memo is required on this chain (Stellar). */
	memo?: boolean;
};

export const INTENTS_CHAINS: readonly IntentsChain[] = [
	{ slug: "base", label: "Base", aliases: ["base", "evm"], network: "Base" },
	{
		slug: "eth",
		label: "Ethereum",
		aliases: ["eth", "ethereum", "mainnet"],
		network: "Ethereum",
	},
	{
		slug: "arb",
		label: "Arbitrum",
		aliases: ["arb", "arbitrum"],
		network: "Arbitrum One",
	},
	{
		slug: "btc",
		label: "Bitcoin",
		aliases: ["btc", "bitcoin"],
		network: "Bitcoin",
	},
	{ slug: "near", label: "NEAR", aliases: ["near"], network: "NEAR" },
	{
		slug: "stellar",
		label: "Stellar",
		aliases: ["stellar", "xlm"],
		network: "Stellar",
		memo: true,
	},
	{
		slug: "sol",
		label: "Solana",
		aliases: ["sol", "solana"],
		network: "Solana",
	},
];

export function resolveChain(input: string): IntentsChain | null {
	const q = input.trim().toLowerCase();
	return (
		INTENTS_CHAINS.find(
			(chain) => chain.slug === q || chain.aliases.includes(q),
		) ?? null
	);
}

/** EVM chains share one deposit address; one call serves all of them. */
export const EVM_CHAIN_SLUGS = ["base", "eth", "arb"];
