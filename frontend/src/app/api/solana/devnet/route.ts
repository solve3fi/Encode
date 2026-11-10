import { createPacedRpcFetch } from "@/lib/server/rpcPacer";
import { DEVNET_DEX_PROGRAM_ADDRESS, DEVNET_VE_PROGRAM_ADDRESS } from "@/configs/dexAddresses";
import { DEV_SITE_URL } from "@/configs/site";
import { createRpcFetch, PUBLIC_DEVNET_RPC } from "@/lib/server/mainnetRpcFetch";
import { createRpcHandler } from "@/lib/server/mainnetRpcProxy";

export const runtime = "nodejs";
// Dedicated Devnet setting: never inherit a mainnet provider credential.
const endpoint = process.env.SOLVE3_DEVNET_RPC_URL || PUBLIC_DEVNET_RPC;
// The free public devnet endpoint rate-limits hard, so keep the old 250 ms spacing there. A private provider key
// (checked 2026-11-06: 70 calls at 40/s returned no errors) can take far more, which makes the Arena load about 5x faster.
const paceMs = endpoint === PUBLIC_DEVNET_RPC ? 250 : 50;
const handle = createRpcHandler(createRpcFetch(endpoint, "devnet", createPacedRpcFetch(globalThis.fetch, { intervalMs: paceMs })), endpoint, {
 publicOrigin: new URL(DEV_SITE_URL).origin,
 clientCallsPerMinute: 600,
 sharedCacheMs: 30_000,
 programIds: [DEVNET_DEX_PROGRAM_ADDRESS, DEVNET_VE_PROGRAM_ADDRESS],
});

export async function POST(request: Request) {
 if (process.env.NEXT_PUBLIC_SITE_VARIANT === "main" || process.env.NEXT_PUBLIC_CLUSTER !== "devnet")
  return new Response(null, { status: 404 });
 return handle(request);
}
