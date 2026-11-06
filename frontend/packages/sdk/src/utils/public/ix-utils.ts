import type { Instruction } from "@solve3fi/common";
import { TransactionBuilder } from "@solve3fi/common";
import type { SolveContext } from "../../context";

export function toTx(
  ctx: SolveContext,
  ix: Instruction,
): TransactionBuilder {
  return new TransactionBuilder(
    ctx.provider.connection,
    ctx.provider.wallet,
    ctx.txBuilderOpts,
  ).addInstruction(ix);
}
