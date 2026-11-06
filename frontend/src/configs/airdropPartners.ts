export type AirdropPartnerMeta = { label: string; logo: string };

// Maps the partner keys stored in AirdropAllocation.partnerAmountsRaw
// (AIRDROP_PARTNERS in src/lib/airdropSnapshot.ts) to a display name and logo
// for the claim page's per-source breakdown. "Test" has no entry here — it's
// a single internal QA wallet, never a real claimant's breakdown.
export const AIRDROP_PARTNER_META: Record<string, AirdropPartnerMeta> = {
	THENA: { label: "THENA", logo: "/assets/airdrop/thena.png" },
	Ramses: { label: "Ramses", logo: "/assets/airdrop/ramses.png" },
	Nile: { label: "Nile", logo: "/assets/airdrop/nile.png" },
	Lynex: { label: "Lynex", logo: "/assets/airdrop/lynex.png" },
	Aerodrome: { label: "Aerodrome", logo: "/assets/airdrop/aero.png" },
	Velodrome: { label: "Velodrome", logo: "/assets/airdrop/velo.png" },
	Equalizer: { label: "Equalizer", logo: "/assets/airdrop/equalizer.png" },
	Scale: { label: "Scale", logo: "/assets/airdrop/scale.png" },
};
