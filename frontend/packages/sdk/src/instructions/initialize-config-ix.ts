import type { Program } from "anchor-legacy";
import type { Keypair, PublicKey } from "@solana/web3.js";
import { SystemProgram } from "@solana/web3.js";
import type { Solve } from "../artifacts/solve";

import type { Instruction } from "@solve3fi/common";

/**
 * Parameters to initialize a SolvesConfig account.
 *
 * @category Instruction Types
 * @param solvesConfigKeypair - Generated keypair for the SolvesConfig.
 * @param feeAuthority - Authority authorized to initialize fee-tiers and set customs fees.
 * @param collect_protocol_fees_authority - Authority authorized to collect protocol fees.
 * @param rewardEmissionsSuperAuthority - Authority authorized to set reward authorities in pools.
 * @param defaultProtocolFeeRate - The default protocol fee rate. Stored as a basis point of the total fees collected by feeRate.
 * @param funder - The account that would fund the creation of this account
 */
export type InitConfigParams = {
  solvesConfigKeypair: Keypair;
  feeAuthority: PublicKey;
  collectProtocolFeesAuthority: PublicKey;
  rewardEmissionsSuperAuthority: PublicKey;
  defaultProtocolFeeRate: number;
  funder: PublicKey;
};

/**
 * Initializes a SolvesConfig account that hosts info & authorities
 * required to govern a set of Solves.
 *
 * @category Instructions
 * @param context - Context object containing services required to generate the instruction
 * @param params - InitConfigParams object
 * @returns - Instruction to perform the action.
 */
export function initializeConfigIx(
  program: Program<Solve>,
  params: InitConfigParams,
): Instruction {
  const {
    feeAuthority,
    collectProtocolFeesAuthority,
    rewardEmissionsSuperAuthority,
    defaultProtocolFeeRate,
    funder,
  } = params;

  const ix = program.instruction.initializeConfig(
    feeAuthority,
    collectProtocolFeesAuthority,
    rewardEmissionsSuperAuthority,
    defaultProtocolFeeRate,
    {
      accounts: {
        config: params.solvesConfigKeypair.publicKey,
        funder,
        systemProgram: SystemProgram.programId,
      },
    },
  );

  return {
    instructions: [ix],
    cleanupInstructions: [],
    signers: [params.solvesConfigKeypair],
  };
}
