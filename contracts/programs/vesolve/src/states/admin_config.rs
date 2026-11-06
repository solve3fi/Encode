use anchor_lang::prelude::*;

use crate::constants::ADMIN_CONFIG_SEED;
use crate::errors::ErrorCode;

pub use solve::state::gate::{DEFAULT_GATE_PHI_PPM, MAX_GATE_PHI_PPM};

/// Systems that can be paused independently (Full Launch rule F2). Swaps and
/// liquidity changes live in the `solve` DEX program and need their own flag
/// there; this account covers everything `vesolve` owns.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PausableSystem {
  Voting,
  Bribes,
  Claims,
  Exit,
  GaugeActivation,
  Emissions,
}

/// Pause switches plus the pending side of a two-step Admin transfer. The
/// current Admin is `Protocol.admin`; there is no compiled-in admin list after
/// `initialize`.
#[account]
#[derive(InitSpace)]
pub struct AdminConfig {
  pub pending_admin: Pubkey,
  pub paused_global: bool,
  pub paused_voting: bool,
  pub paused_bribes: bool,
  pub paused_claims: bool,
  pub paused_exit: bool,
  pub paused_gauge_activation: bool,
  pub paused_emissions: bool,
  /// Activity-gate threshold set by Admin; `gate_phi_ppm` only counts when
  /// `gate_phi_set`, otherwise the DEX default applies. 0 disables the gate.
  pub gate_phi_set: bool,
  pub gate_phi_ppm: u32,
  /// Where bribes for gauges that end up with no voters or were removed go.
  /// `Pubkey::default()` until Admin sets it.
  pub treasury: Pubkey,
  pub bump: u8,
}

impl AdminConfig {
  /// A system is stopped by its own flag or by the global (nuclear) pause.
  /// Clearing the global pause and setting individual flags is how claims are
  /// restored while other systems stay paused.
  pub fn is_paused(&self, system: PausableSystem) -> bool {
    self.paused_global
      || match system {
        PausableSystem::Voting => self.paused_voting,
        PausableSystem::Bribes => self.paused_bribes,
        PausableSystem::Claims => self.paused_claims,
        PausableSystem::Exit => self.paused_exit,
        PausableSystem::GaugeActivation => self.paused_gauge_activation,
        PausableSystem::Emissions => self.paused_emissions,
      }
  }

  /// The configured gate threshold in ppm, or the default when the account was
  /// never created or no value was set.
  pub fn gate_phi_ppm(info: &AccountInfo, program_id: &Pubkey) -> Result<u32> {
    Ok(Self::read(info, program_id)?
      .filter(|c| c.gate_phi_set)
      .map_or(DEFAULT_GATE_PHI_PPM, |c| c.gate_phi_ppm))
  }

  /// The canonical config if it exists. Same PDA check as `require_not_paused`.
  pub fn read(info: &AccountInfo, program_id: &Pubkey) -> Result<Option<AdminConfig>> {
    let (expected, _) = Pubkey::find_program_address(&[ADMIN_CONFIG_SEED], program_id);
    require_keys_eq!(info.key(), expected, ErrorCode::InvalidOwner);
    if info.owner != program_id || info.data_is_empty() {
      return Ok(None);
    }
    let data = info.try_borrow_data()?;
    Ok(Some(AdminConfig::try_deserialize(&mut &data[..])?))
  }

  /// Guard for instructions that take the config as a raw account. An account
  /// that was never created means nothing has been paused. A present account
  /// must be this program's canonical PDA, so a caller cannot dodge a pause by
  /// substituting a different (or empty) account.
  pub fn require_not_paused(
    info: &AccountInfo,
    program_id: &Pubkey,
    system: PausableSystem,
  ) -> Result<()> {
    let (expected, _) = Pubkey::find_program_address(&[ADMIN_CONFIG_SEED], program_id);
    require_keys_eq!(info.key(), expected, ErrorCode::InvalidOwner);
    if info.owner != program_id || info.data_is_empty() {
      return Ok(());
    }
    let data = info.try_borrow_data()?;
    let config = AdminConfig::try_deserialize(&mut &data[..])?;
    require!(!config.is_paused(system), ErrorCode::SystemPaused);
    Ok(())
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  fn config() -> AdminConfig {
    AdminConfig {
      pending_admin: Pubkey::default(),
      paused_global: false,
      paused_voting: false,
      paused_bribes: false,
      paused_claims: false,
      paused_exit: false,
      paused_gauge_activation: false,
      paused_emissions: false,
      gate_phi_set: false,
      gate_phi_ppm: 0,
      treasury: Pubkey::default(),
      bump: 255,
    }
  }

  const ALL: [PausableSystem; 6] = [
    PausableSystem::Voting,
    PausableSystem::Bribes,
    PausableSystem::Claims,
    PausableSystem::Exit,
    PausableSystem::GaugeActivation,
    PausableSystem::Emissions,
  ];

  #[test]
  fn nothing_is_paused_by_default() {
    for system in ALL {
      assert!(!config().is_paused(system));
    }
  }

  #[test]
  fn each_flag_stops_only_its_own_system() {
    for paused in ALL {
      let mut c = config();
      match paused {
        PausableSystem::Voting => c.paused_voting = true,
        PausableSystem::Bribes => c.paused_bribes = true,
        PausableSystem::Claims => c.paused_claims = true,
        PausableSystem::Exit => c.paused_exit = true,
        PausableSystem::GaugeActivation => c.paused_gauge_activation = true,
        PausableSystem::Emissions => c.paused_emissions = true,
      }
      for system in ALL {
        assert_eq!(c.is_paused(system), system == paused, "{paused:?} vs {system:?}");
      }
    }
  }

  #[test]
  fn global_pause_stops_everything_and_claims_can_be_restored_alone() {
    let mut c = config();
    c.paused_global = true;
    assert!(ALL.iter().all(|s| c.is_paused(*s)));

    // Restore claims only: clear global, keep every other system paused.
    c.paused_global = false;
    c.paused_voting = true;
    c.paused_bribes = true;
    c.paused_exit = true;
    c.paused_gauge_activation = true;
    c.paused_emissions = true;
    assert!(!c.is_paused(PausableSystem::Claims));
    assert!(c.is_paused(PausableSystem::Voting));
    assert!(c.is_paused(PausableSystem::Emissions));
  }

  fn guard(owner: Pubkey, program_id: Pubkey, cfg: Option<AdminConfig>, sys: PausableSystem) -> Result<()> {
    let (key, _) = Pubkey::find_program_address(&[ADMIN_CONFIG_SEED], &program_id);
    let mut lamports = 1u64;
    let mut data: Vec<u8> = match cfg {
      Some(c) => {
        let mut buf = AdminConfig::DISCRIMINATOR.to_vec();
        c.serialize(&mut buf).unwrap();
        buf
      }
      None => vec![],
    };
    let info = AccountInfo::new(&key, false, false, &mut lamports, &mut data, &owner, false, 0);
    AdminConfig::require_not_paused(&info, &program_id, sys)
  }

  #[test]
  fn guard_allows_when_unconfigured_and_blocks_when_paused() {
    let program_id = Pubkey::new_unique();
    let system = anchor_lang::system_program::ID;
    assert!(guard(system, program_id, None, PausableSystem::Voting).is_ok());
    assert!(guard(program_id, program_id, Some(config()), PausableSystem::Voting).is_ok());
    let mut paused = config();
    paused.paused_voting = true;
    assert!(guard(program_id, program_id, Some(paused), PausableSystem::Voting).is_err());
  }

  #[test]
  fn guard_rejects_a_substituted_account() {
    let program_id = Pubkey::new_unique();
    let wrong = Pubkey::new_unique();
    let mut lamports = 1u64;
    let mut data = vec![];
    let owner = anchor_lang::system_program::ID;
    let info = AccountInfo::new(&wrong, false, false, &mut lamports, &mut data, &owner, false, 0);
    assert!(AdminConfig::require_not_paused(&info, &program_id, PausableSystem::Voting).is_err());
  }
}
