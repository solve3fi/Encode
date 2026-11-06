import type { Address } from "anchor-legacy";
import type { SolveRouter } from ".";
import type { SolveContext } from "../..";
import type { PoolGraph } from "../../utils/public";
import { PoolGraphBuilder } from "../../utils/public";
import { SolveRouterImpl } from "../router-impl";

/**
 * Builder to build instances of the {@link SolveRouter}
 * @category Router
 *
 * @deprecated SolveRouter will be removed in the future release. Please use endpoint which provides qoutes.
 */
export class SolveRouterBuilder {
  /**
   * Builds a {@link SolveRouter} with a prebuilt {@link PoolGraph}
   *
   * @param ctx A {@link SolveContext} for the current execution environment
   * @param graph A {@link PoolGraph} that represents the connections between all pools.
   * @returns A {@link SolveRouter} that can be used to find routes and execute swaps
   *
   * @deprecated SolveRouter will be removed in the future release. Please use endpoint which provides qoutes.
   */
  static buildWithPoolGraph(
    ctx: SolveContext,
    graph: PoolGraph,
  ): SolveRouter {
    return new SolveRouterImpl(ctx, graph);
  }

  /**
   * Fetch and builds a {@link SolveRouter} with a list of pool addresses.
   * @param ctx A {@link SolveContext} for the current execution environment
   * @param pools A list of {@link Address}es that the router will find routes through.
   * @returns A {@link SolveRouter} that can be used to find routes and execute swaps
   *
   * @deprecated SolveRouter will be removed in the future release. Please use endpoint which provides qoutes.
   */
  static async buildWithPools(
    ctx: SolveContext,
    pools: Address[],
  ): Promise<SolveRouter> {
    const poolGraph = await PoolGraphBuilder.buildPoolGraphWithFetch(
      pools,
      ctx.fetcher,
    );
    return new SolveRouterImpl(ctx, poolGraph);
  }
}
