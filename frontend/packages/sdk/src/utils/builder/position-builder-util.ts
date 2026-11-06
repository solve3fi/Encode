import type { SolveContext } from "../..";
import type { SolveAccountFetchOptions } from "../../network/public/fetcher";
import type { PositionData, SolveData } from "../../types/public";
import { PDAUtil } from "../public";

export async function getTickArrayDataForPosition(
  ctx: SolveContext,
  position: PositionData,
  solve: SolveData,
  opts?: SolveAccountFetchOptions,
) {
  const lowerTickArrayKey = PDAUtil.getTickArrayFromTickIndex(
    position.tickLowerIndex,
    solve.tickSpacing,
    position.solve,
    ctx.program.programId,
  ).publicKey;
  const upperTickArrayKey = PDAUtil.getTickArrayFromTickIndex(
    position.tickUpperIndex,
    solve.tickSpacing,
    position.solve,
    ctx.program.programId,
  ).publicKey;

  return await ctx.fetcher.getTickArrays(
    [lowerTickArrayKey, upperTickArrayKey],
    opts,
  );
}
