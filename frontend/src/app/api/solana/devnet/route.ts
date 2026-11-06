import { createPacedRpcFetch } from "@/lib/server/rpcPacer";
import { DEVNET_DEX_PROGRAM_ADDRESS, DEVNET_VE_PROGRAM_ADDRESS } from "@/configs/dexAddresses";
import { createRpcFetch, PUBLIC_DEVNET_RPC } from "@/lib/server/mainnetRpcFetch";
import { createRpcHandler } from "@/lib/server/mainnetRpcProxy";

export const runtime = "nodejs";
// Dedicated Devnet setting: never inherit a mainnet provider credential.
const endpoint = process.env.SOLVE3_DEVNET_RPC_URL || PUBLIC_DEVNET_RPC;
const handle = createRpcHandler(createRpcFetch(endpoint, "devnet", createPacedRpcFetch(globalThis.fetch)), endpoint, {
 publicOrigin: "https://dev.solve3.fi",
 clientCallsPerMinute: 600,
 sharedCacheMs: 30_000,
 programIds: [DEVNET_DEX_PROGRAM_ADDRESS, DEVNET_VE_PROGRAM_ADDRESS],
});

export async function POST(request: Request) {
 if (process.env.NEXT_PUBLIC_SITE_VARIANT === "main" || process.env.NEXT_PUBLIC_CLUSTER !== "devnet")
  return new Response(null, { status: 404 });
 return handle(request);
}
