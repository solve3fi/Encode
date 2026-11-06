// Solve3 x402 agent (solve3fi/X402-agent): vote optimiser, claim-all and unsigned transaction builder.
// Devnet only. The page and its proxy route stay off unless the deployment opts in.
export const AGENT_ENABLED = process.env.NEXT_PUBLIC_AGENT_ENABLED === "1";

/** Public x402 API facts shown on the API pages. Keep in step with the agent's X402_PRICE_* settings. */
export const AGENT_API = {
	baseUrl: (process.env.NEXT_PUBLIC_AGENT_API_URL ?? "https://agent.solve3.fi").replace(/\/$/, ""),
	priceRead: "$0.005",
	priceTx: "$0.02",
	network: "Solana Devnet",
	asset: "devUSDC",
	// The Solve3 faucet token (the agent bills in it via X402_ASSET). Name kept as usdcMint for the pages that already use it.
	usdcMint: "FrN7oiLccXBSRCJGoAACUHSp3Efvji7mkwfGpZXcV6Up",
	treasury: "HRmz8NhLJDXYiSyR6STzBkofJZGb9ZMbbEh3rMHRVXNV",
} as const;
