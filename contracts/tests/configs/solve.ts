export const PROGRAM_CONFIG = "7qa4T2XcktZcKjM9ib51dcLeLXVJ5zudufhiJo9F8WjB";
export const PROGRAM_CONFIG_EXTENSION =
	"3KB3AC8pSs4jUXWe6fu7Q3r5E88rgC49qtHcKxKXvXTE";

// The solve3 fee policy routes 100% of each trade fee to the pool's gauge
// reward/bribe flow for voter distribution.
export const DEFAULT_PROTOCOL_FEE_RATE = 10000;
export const PROTOCOL_FEE_AUTHORITY =
	"Bbx8tpTG9fTnE5CXjZLys9gQi1i4nDUFn6MrU4Gby14J";

export const FEE_TIERS = [
	{
		fee: 100,
		tickSpacing: 1,
	},
	{
		fee: 200,
		tickSpacing: 2,
	},
	{
		fee: 500,
		tickSpacing: 8,
	},
	{
		fee: 1600,
		tickSpacing: 16,
	},
	{
		fee: 3000,
		tickSpacing: 64,
	},
	{
		fee: 6500,
		tickSpacing: 96,
	},
	{
		fee: 10000,
		tickSpacing: 128,
	},
	{
		fee: 20000,
		tickSpacing: 256,
	},
];
