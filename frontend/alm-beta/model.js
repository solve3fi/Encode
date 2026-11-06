// Browser-only presentation model. No RPC, custody, signing or transaction calls.
export const demoPositions = [
  {
    id: "demo-sol",
    pair: "SOL / USDC",
    token: "≋",
    tokenClass: "",
    strategy: "Delayed rebalance · 0.05%",
    value: 14820,
    allocation: "59.6% of portfolio",
    lower: 138.4,
    upper: 156.2,
    price: 146.8,
    fees: "$42.68",
    inRange: true,
    marker: 47,
    liquidity: "Illustrative",
    address: "Demo position · SOL / USDC",
  },
  {
    id: "demo-jup",
    pair: "JUP / USDC",
    token: "◒",
    tokenClass: "jup",
    strategy: "Delayed rebalance · 0.30%",
    value: 6250,
    allocation: "25.2% of portfolio",
    lower: 0.74,
    upper: 0.92,
    price: 0.83,
    fees: "$18.24",
    inRange: true,
    marker: 50,
    liquidity: "Illustrative",
    address: "Demo position · JUP / USDC",
  },
  {
    id: "demo-bonk",
    pair: "BONK / USDC",
    token: "◕",
    tokenClass: "bonk",
    strategy: "Delayed rebalance · 0.30%",
    value: 3780,
    allocation: "15.2% of portfolio",
    lower: 0.000018,
    upper: 0.000024,
    price: 0.000026,
    fees: "$6.92",
    inRange: false,
    marker: 94,
    liquidity: "Illustrative",
    address: "Demo position · BONK / USDC",
  },
];
export const money = (value) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(value);
export const price = (value) =>
  Number(value).toLocaleString("en-US", {
    maximumFractionDigits: value < 0.001 ? 8 : 4,
    minimumFractionDigits: value >= 1 ? 2 : 0,
  });
export const short = (value) =>
  value.length > 16 ? `${value.slice(0, 6)}…${value.slice(-4)}` : value;
export function units(raw, decimals) {
  const amount = BigInt(raw),
    scale = 10n ** BigInt(decimals);
  const fraction = (amount % scale)
    .toString()
    .padStart(decimals, "0")
    .replace(/0+$/, "");
  return `${amount / scale}${fraction ? `.${fraction}` : ""}`;
}
const address = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const uint = /^(0|[1-9][0-9]{0,77})$/;
function requireThat(condition, message) {
  if (!condition) throw new Error(message);
}
export function parseSnapshot(input) {
  const s = input?.snapshot ?? input;
  requireThat(
    s && typeof s === "object" && !Array.isArray(s),
    "Choose the JSON output of the keeper inspect command.",
  );
  requireThat(
    s.cluster === "devnet" || s.cluster === "mainnet",
    "Snapshot cluster must be devnet or mainnet.",
  );
  for (const key of ["pool", "owner", "mintA", "mintB", "programId"])
    requireThat(
      typeof s[key] === "string" && address.test(s[key]),
      `Snapshot has an invalid ${key}.`,
    );
  for (const key of ["decimalsA", "decimalsB"])
    requireThat(
      Number.isInteger(s[key]) && s[key] >= 0 && s[key] <= 18,
      "Token decimals must be between 0 and 18.",
    );
  for (const key of ["balanceA", "balanceB", "solLamports"])
    requireThat(
      typeof s[key] === "string" && uint.test(s[key]),
      `Snapshot ${key} must be an unsigned base-unit string.`,
    );
  requireThat(
    Number.isInteger(s.tick) && Math.abs(s.tick) <= 443636,
    "Snapshot tick is outside Solve3 pool bounds.",
  );
  requireThat(
    Number.isInteger(s.tickSpacing) &&
      s.tickSpacing > 0 &&
      s.tickSpacing <= 32768,
    "Snapshot needs a valid tick spacing.",
  );
  requireThat(
    Number.isSafeInteger(s.observedAt) &&
      s.observedAt >= 0 &&
      s.observedAt <= 8640000000000,
    "Snapshot needs a valid observation timestamp.",
  );
  requireThat(
    Number.isSafeInteger(s.slot) && s.slot >= 0,
    "Snapshot needs a valid slot.",
  );
  requireThat(
    Array.isArray(s.positions) && s.positions.length <= 500,
    "Snapshot must contain a positions array (maximum 500).",
  );
  for (const p of s.positions) {
    requireThat(
      p && typeof p.address === "string" && address.test(p.address),
      "A position address is invalid.",
    );
    requireThat(
      Number.isInteger(p.lower) &&
        Number.isInteger(p.upper) &&
        p.lower >= -443636 &&
        p.upper <= 443636 &&
        p.lower < p.upper,
      "A position has invalid tick bounds.",
    );
    for (const key of ["liquidity", "feeA", "feeB"])
      requireThat(
        typeof p[key] === "string" && uint.test(p[key]),
        `Position ${key} must be a base-unit string.`,
      );
  }
  return s;
}
export function snapshotPositions(s) {
  return s.positions.map((p, i) => ({
    id: `snapshot-${i}`,
    pair: "Token A / Token B",
    token: "A",
    tokenClass: "generic",
    strategy: `Observed position · tick spacing ${s.tickSpacing}`,
    value: null,
    allocation: "USD valuation unavailable",
    lower: p.lower,
    upper: p.upper,
    price: s.tick,
    ticks: true,
    fees: `${units(p.feeA, s.decimalsA)} A / ${units(p.feeB, s.decimalsB)} B`,
    inRange: s.tick >= p.lower && s.tick < p.upper,
    marker: Math.max(
      3,
      Math.min(97, ((s.tick - p.lower) / (p.upper - p.lower)) * 100),
    ),
    liquidity: p.liquidity,
    address: p.address,
  }));
}
export function validateStrategy(value) {
  requireThat(
    value &&
      Number.isInteger(value.halfWidthTicks) &&
      value.halfWidthTicks >= 16 &&
      value.halfWidthTicks <= 512 &&
      value.halfWidthTicks % 8 === 0,
    "Choose a valid range width.",
  );
  requireThat(
    [60, 180, 300].includes(value.outOfRangeSeconds) &&
      [300, 900, 1800].includes(value.cooldownSeconds),
    "Choose a supported delay and cooldown.",
  );
  requireThat(
    Number.isInteger(value.maxActionsPerDay) &&
      value.maxActionsPerDay >= 1 &&
      value.maxActionsPerDay <= 24,
    "Daily action limit must be a whole number from 1 to 24.",
  );
  return value;
}
