//! Productive-liquidity activity gate (Full Launch decision D1/D3/D4).
//!
//! A pool's gauge emission is earned during an hour only if the pool showed
//! enough fee yield in the previous whole hour. Fees never scale an individual
//! position; they only open or close a pool-wide switch. The state lives in the
//! pool's secondary extension (32 bytes, no account migration) and is rolled
//! lazily at every checkpoint, so no keeper is needed. Hours with no checkpoint
//! had no swaps, hence zero yield, hence a closed gate.
use crate::math::U256;

#[cfg(not(feature = "fast-epochs"))]
pub const GATE_BUCKET_SECONDS: u64 = 3_600;
/// Test-only: epoch / 168 for the 20 minute fast epoch.
#[cfg(feature = "fast-epochs")]
pub const GATE_BUCKET_SECONDS: u64 = 7;
/// Yield accumulator unit: 2^-40 of the in-range liquidity value.
pub const GATE_YIELD_SHIFT: u32 = 40;
/// Default threshold: 1 basis point per hour, in parts per million.
#[cfg(not(feature = "fast-epochs"))]
pub const DEFAULT_GATE_PHI_PPM: u32 = 100;
/// Test-only: the 7 second bucket would need ~3% turnover per bucket at the
/// mainnet threshold; scale by 7/3600 (0.19 ppm) and round up to the 1 ppm minimum.
#[cfg(feature = "fast-epochs")]
pub const DEFAULT_GATE_PHI_PPM: u32 = 1;
pub const MAX_GATE_PHI_PPM: u32 = 10_000; // 1%
const GATE_MARKER: u8 = 0xA5;

#[derive(Copy, Clone, Debug, Default, PartialEq)]
pub struct GateState {
    pub bucket_hour: u32,
    pub phi_ppm: u32,
    /// Fee yield accumulated in `bucket_hour`, units of 2^-40.
    pub acc: u64,
    /// Whether the gate is open for `bucket_hour` (decided by the hour before).
    pub open: bool,
}

impl GateState {
    pub fn new(now: u64, phi_ppm: u32) -> Self {
        Self { bucket_hour: hour_of(now), phi_ppm, acc: 0, open: false }
    }

    pub fn threshold_acc(&self) -> u64 {
        // phi_ppm / 1e6 in units of 2^-40
        ((u128::from(self.phi_ppm) << GATE_YIELD_SHIFT) / 1_000_000) as u64
    }

    pub fn to_bytes(&self) -> [u8; 32] {
        let mut b = [0u8; 32];
        b[0] = GATE_MARKER;
        b[1] = u8::from(self.open);
        b[2..6].copy_from_slice(&self.bucket_hour.to_le_bytes());
        b[6..10].copy_from_slice(&self.phi_ppm.to_le_bytes());
        b[10..18].copy_from_slice(&self.acc.to_le_bytes());
        b
    }

    /// None for an all-zero or foreign secondary extension.
    pub fn from_bytes(b: &[u8; 32]) -> Option<Self> {
        if b[0] != GATE_MARKER || b[18..].iter().any(|x| *x != 0) || b[1] > 1 {
            return None;
        }
        Some(Self {
            open: b[1] == 1,
            bucket_hour: u32::from_le_bytes(b[2..6].try_into().ok()?),
            phi_ppm: u32::from_le_bytes(b[6..10].try_into().ok()?),
            acc: u64::from_le_bytes(b[10..18].try_into().ok()?),
        })
    }

    /// Seconds of the window [from, to) during which the gate is open, given
    /// that no swap happened inside the window (every swap is a checkpoint).
    pub fn open_seconds(&self, from: u64, to: u64) -> u64 {
        if to <= from {
            return 0;
        }
        let start = u64::from(self.bucket_hour) * GATE_BUCKET_SECONDS;
        let mid = start + GATE_BUCKET_SECONDS;
        let overlap = |a: u64, b: u64| to.min(b).saturating_sub(from.max(a));
        let mut open = 0;
        if self.open {
            open += overlap(start, mid);
        }
        if self.acc >= self.threshold_acc() {
            open += overlap(mid, mid + GATE_BUCKET_SECONDS);
        }
        open
    }

    /// Moves to the hour containing `now`. The hour after a complete bucket
    /// opens iff that bucket's yield reached the threshold; later hours are
    /// closed because nothing was traded in them.
    pub fn roll(&mut self, now: u64) {
        let hour = hour_of(now);
        if hour <= self.bucket_hour {
            return;
        }
        self.open = hour == self.bucket_hour.saturating_add(1) && self.acc >= self.threshold_acc();
        self.acc = 0;
        self.bucket_hour = hour;
    }

    pub fn add_yield(&mut self, y: u64) {
        self.acc = self.acc.saturating_add(y);
    }
}

pub fn hour_of(ts: u64) -> u32 {
    u32::try_from(ts / GATE_BUCKET_SECONDS).unwrap_or(u32::MAX)
}

/// `amount · √P²` with √P in Q64.64, via the Q64.64 price (≤ 2^192, so a u64
/// amount cannot overflow 256 bits).
fn mul_price_q64(amount: u128, sqrt_price_x64: u128) -> U256 {
    let price_q64 = (U256::from(sqrt_price_x64) * U256::from(sqrt_price_x64)) >> 64;
    (U256::from(amount) * price_q64) >> 64
}

/// Value of a swap step's fee in token B (raw units): token-B fees as they are,
/// token-A fees converted at the step's price (√P² in Q128).
pub fn step_fee_value_b(fee: u64, sqrt_price_x64: u128, fee_in_a: bool) -> u128 {
    if !fee_in_a {
        return u128::from(fee);
    }
    u128::try_from(mul_price_q64(u128::from(fee), sqrt_price_x64)).unwrap_or(u128::MAX)
}

/// The pool's real capital in token B: what its vaults hold, excluding the
/// protocol's uncollected fees, with token A priced at the current √P. This
/// is deliberately NOT the virtual depth `2·L·√P`: concentrated liquidity is
/// leveraged (a ±1% range is ~200x), so yield on virtual depth would ask
/// concentrated pools for 200x the volume it asks of full-range pools. Vault
/// balances need no tick walk and no price oracle.
pub fn pool_value_b(vault_a: u64, vault_b: u64, protocol_owed_a: u64, protocol_owed_b: u64, sqrt_price_x64: u128) -> u128 {
    let a = u128::from(vault_a.saturating_sub(protocol_owed_a));
    let b = u128::from(vault_b.saturating_sub(protocol_owed_b));
    b.saturating_add(u128::try_from(mul_price_q64(a, sqrt_price_x64)).unwrap_or(u128::MAX))
}

/// Fee yield as a fraction of the pool's value, in units of 2^-40. Saturates
/// (never panics); a lost contribution only keeps the gate closed. A pool with
/// no value yields 0.
pub fn fee_yield(fee_value_b: u128, pool_value_b: u128) -> u64 {
    if fee_value_b == 0 || pool_value_b == 0 {
        return 0;
    }
    let q = (U256::from(fee_value_b) << GATE_YIELD_SHIFT) / U256::from(pool_value_b);
    u64::try_from(q.min(U256::from(u64::MAX))).unwrap_or(u64::MAX)
}

#[cfg(test)]
mod tests {
    use super::*;

    const H: u64 = GATE_BUCKET_SECONDS;

    #[test]
    fn yield_is_scale_free_and_matches_basis_points() {
        // price 1 (√P = 2^64), vaults 1e12 of each token = 2e12 in B, fee 1e9 in either token = 5 bp
        let s = 1u128 << 64;
        let value = pool_value_b(1_000_000_000_000, 1_000_000_000_000, 0, 0, s);
        assert_eq!(value, 2_000_000_000_000);
        let a = fee_yield(step_fee_value_b(1_000_000_000, s, true), value);
        let b = fee_yield(step_fee_value_b(1_000_000_000, s, false), value);
        assert_eq!(a, b);
        let bp = (u128::from(a) * 10_000) >> GATE_YIELD_SHIFT;
        assert_eq!(bp, 4); // 5 bp floors to 4 whole units of 1 bp
        // doubling the pool's value halves the yield
        assert_eq!(fee_yield(1_000_000_000, 4_000_000_000_000), a / 2);
        // never panics on extremes
        assert_eq!(fee_yield(0, 1), 0);
        assert_eq!(fee_yield(1, 0), 0);
        let _ = fee_yield(u128::MAX, 1);
        let _ = step_fee_value_b(u64::MAX, u128::MAX, true);
        let _ = pool_value_b(u64::MAX, u64::MAX, 0, 0, u128::MAX);
    }

    #[test]
    fn price_converts_token_a_and_protocol_fees_are_not_capital() {
        // √P = 2 (P = 4): 100 of token A are worth 400 of token B
        let s = 2u128 << 64;
        assert_eq!(pool_value_b(100, 50, 0, 0, s), 450);
        assert_eq!(step_fee_value_b(10, s, true), 40);
        assert_eq!(step_fee_value_b(10, s, false), 10);
        // uncollected protocol fees sit in the vault but are not LP capital
        assert_eq!(pool_value_b(100, 50, 25, 10, s), 300 + 40);
        assert_eq!(pool_value_b(5, 5, 9, 9, s), 0);
    }

    #[test]
    fn concentration_does_not_raise_the_bar() {
        // Same real capital and same fees => same yield, whatever the range.
        // (Yield on virtual depth would be ~200x lower for a ±1% range.)
        let s = 1u128 << 64;
        let value = pool_value_b(50_000, 50_000, 0, 0, s);
        let y = fee_yield(step_fee_value_b(10, s, true), value);
        assert!(y > 0);
        assert_eq!(y, fee_yield(10, 100_000));
    }

    // Offsets inside the hour (50 s, 10 s) assume the 3600 s release bucket; the
    // 7 s fast-epochs bucket cannot hold them (the same logic runs in the release build).
    #[cfg(not(feature = "fast-epochs"))]
    #[test]
    fn gate_opens_only_after_a_hour_with_enough_yield() {
        let mut g = GateState::new(10 * H + 5, DEFAULT_GATE_PHI_PPM);
        assert!(!g.open);
        assert_eq!(g.open_seconds(10 * H + 5, 10 * H + 100), 0);
        g.add_yield(g.threshold_acc());
        // window crossing into the next hour: only the next hour's part is open
        assert_eq!(g.open_seconds(10 * H + 5, 11 * H + 50), 50);
        g.roll(11 * H + 50);
        assert!(g.open && g.acc == 0 && g.bucket_hour == 11);
        // yield below threshold during hour 11 keeps hour 12 closed
        g.add_yield(g.threshold_acc() - 1);
        assert_eq!(g.open_seconds(11 * H + 50, 12 * H + 10), H - 50);
        g.roll(12 * H + 10);
        assert!(!g.open);
    }

    #[test]
    fn default_threshold_is_one_basis_point_per_hour_on_the_release_build() {
        #[cfg(not(feature = "fast-epochs"))]
        assert_eq!(DEFAULT_GATE_PHI_PPM, 100);
        #[cfg(feature = "fast-epochs")]
        assert_eq!(DEFAULT_GATE_PHI_PPM, 1);
    }

    #[test]
    fn a_skipped_hour_closes_the_gate() {
        let mut g = GateState::new(10 * H, DEFAULT_GATE_PHI_PPM);
        g.add_yield(g.threshold_acc());
        g.roll(12 * H + 1); // hour 11 had no checkpoint
        assert!(!g.open);
        assert_eq!(g.bucket_hour, 12);
    }

    #[test]
    fn state_round_trips_and_rejects_foreign_bytes() {
        let mut g = GateState::new(7 * H, 250);
        g.open = true;
        g.acc = 12345;
        assert_eq!(GateState::from_bytes(&g.to_bytes()), Some(g));
        assert_eq!(GateState::from_bytes(&[0; 32]), None);
        let mut b = g.to_bytes();
        b[31] = 1;
        assert_eq!(GateState::from_bytes(&b), None);
    }
}
