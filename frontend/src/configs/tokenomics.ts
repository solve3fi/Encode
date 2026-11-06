// From https://docs.solve3.fi/overview/tokenomics/token-supply-and-emissions —
// genesis allocation 100,000,000 SOLV3 (docs use the SLV/veSLV names for the same
// token this project calls SOLV3/veSOLV3). No wallet addresses are published
// there; admins assign and persist them via AdminTokenomics.
export const TOTAL_SUPPLY = 100_000_000;

export type TokenomicsCategory = {
	key: string;
	name: string;
	amount: number;
	percent: number;
	locked: boolean; // true = allocated as veSOLV3 (locked), false = liquid SOLV3
};

export const TOKENOMICS_CATEGORIES: TokenomicsCategory[] = [
	{ key: "community-airdrop", name: "Community Airdrop", amount: 10_000_000, percent: 10, locked: true },
	{ key: "presale", name: "Presale", amount: 15_000_000, percent: 15, locked: true },
	{ key: "ecosystem-grants", name: "Ecosystem Grants & Incentives", amount: 8_000_000, percent: 8, locked: true },
	{ key: "dao-treasury", name: "DAO Treasury", amount: 20_000_000, percent: 20, locked: true },
	{ key: "team", name: "Team", amount: 21_000_000, percent: 21, locked: true },
	{ key: "marketing", name: "Marketing", amount: 5_000_000, percent: 5, locked: true },
	{ key: "accelerator", name: "Accelerator Program", amount: 10_000_000, percent: 10, locked: true },
	{ key: "advisors", name: "Advisors", amount: 7_000_000, percent: 7, locked: true },
	{ key: "initial-liquidity", name: "Initial Liquidity", amount: 4_000_000, percent: 4, locked: false },
];

// Weekly emissions schedule constants already live in @/utils/epoch —
// reuse those instead of a second copy.
export { DEVELOPER_ALLOCATION, INITIAL_WEEKLY_EMISSIONS, WEEKLY_EMISSIONS_DECAY } from "@/utils/epoch";
