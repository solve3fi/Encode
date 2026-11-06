use anchor_lang::prelude::*;

pub const PAIR_SEED: &[u8] = b"pair";

/// The one gauge-eligible pool of a token pair (INV-G1). The PDA is derived
/// from the sorted pair, so two pools of the same pair always meet here.
/// `gauge` is the current or pending occupant; it is free again once that
/// gauge is REMOVED.
#[account]
#[derive(InitSpace)]
pub struct PairCanonical {
  pub mint_lo: Pubkey,
  pub mint_hi: Pubkey,
  pub gauge: Pubkey,
  pub bump: u8,
}

/// The pair's mints in canonical order.
pub fn sorted_pair(a: &Pubkey, b: &Pubkey) -> (Pubkey, Pubkey) {
  if a.to_bytes() <= b.to_bytes() {
    (*a, *b)
  } else {
    (*b, *a)
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn pair_order_does_not_depend_on_argument_order() {
    let (x, y) = (Pubkey::new_unique(), Pubkey::new_unique());
    assert_eq!(sorted_pair(&x, &y), sorted_pair(&y, &x));
    let (lo, hi) = sorted_pair(&x, &y);
    assert!(lo.to_bytes() <= hi.to_bytes());
  }
}
