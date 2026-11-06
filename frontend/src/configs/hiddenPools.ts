// Solve pool accounts can't be closed once created (no close_pool
// instruction exists — only positions can be closed), so an orphaned pool
// has to be hidden by address rather than removed on-chain. Shared by
// useAllPools (the Pools/Liquidity listings), useVotes (the Vote page and
// the Bribes pool picker — both consume the same gauge list), and anywhere
// else that enumerates pools or gauges for display or selection.
//
// - 8wGcGQsDCmnXkYxBrSHiWwPa9CoGCjq5Kd3pKJPgoGV: created against a foreign
//   devnet mint (BRjpCHty...oGuo) that only *displays* as "devUSDC" via
//   @solana/spl-token-registry's bundled list and that this project has no
//   mint authority over, so it can never be seeded — it just sits at $0
//   next to the real SOLV3/devUSDC pool and duplicates its label.
// - 8WWcvVNaFVAC7zDUyP8NcTrfLk6ETdzA8UDw2jrZ5Ejz: another orphaned,
//   zero-liquidity pool whose two mints don't resolve in any of this app's
//   token sources at all, so it just shows raw addresses with nothing in it.
// - DiCvABbjrTtcXWaaKjWCoBCJu3NNvrT6RnuXorj6jJzZ: SOL/TEST, does have real
//   liquidity but is hidden by request — not an orphan, just not meant to
//   be listed.
export const HIDDEN_POOL_ADDRESSES = new Set([
	"8wGcGQsDCmnXkYxBrSHiWwPa9CoGCjq5Kd3pKJPgoGV",
	"8WWcvVNaFVAC7zDUyP8NcTrfLk6ETdzA8UDw2jrZ5Ejz",
	"DiCvABbjrTtcXWaaKjWCoBCJu3NNvrT6RnuXorj6jJzZ",
]);
