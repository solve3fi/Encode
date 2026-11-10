import type { RpcFetch } from "./mainnetRpcFetch";

export class RpcQueueFullError extends Error {
 constructor() { super("RPC request queue is full"); this.name = "RpcQueueFullError"; }
}

function pause(ms: number, signal?: AbortSignal | null): Promise<void> {
 return new Promise((resolve, reject) => {
  if (signal?.aborted) { reject(signal.reason); return; }
  const done = () => { signal?.removeEventListener("abort", abort); resolve(); };
  const timer = setTimeout(done, ms);
  const abort = () => { clearTimeout(timer); signal?.removeEventListener("abort", abort); reject(signal?.reason); };
  signal?.addEventListener("abort", abort, { once: true });
 });
}

/** Pace physical HTTP calls, including identity probes and fallback requests. */
export function createPacedRpcFetch(
 request: RpcFetch,
 options: {
  intervalMs?: number; maxPending?: number;
  now?: () => number;
  sleep?: (ms: number, signal?: AbortSignal | null) => Promise<void>;
 } = {},
): RpcFetch {
 const interval = options.intervalMs ?? 250;
 const maximum = options.maxPending ?? 96;
 const now = options.now ?? (() => performance.now());
 const sleep = options.sleep ?? pause;
 if (!Number.isFinite(interval) || interval < 0 || !Number.isInteger(maximum) || maximum < 1)
  throw new Error("Invalid RPC pacing configuration");
 let nextAllowed = 0, pending = 0;
 let turn = Promise.resolve();
 return async (input, init) => {
  init?.signal?.throwIfAborted();
  if (pending >= maximum) throw new RpcQueueFullError();
  pending++;
  const previous = turn;
  let release!: () => void;
  turn = new Promise<void>((resolve) => { release = resolve; });
  let released = false;
  const releaseTurn = () => { if (!released) { released = true; release(); } };
  try {
   await previous;
   init?.signal?.throwIfAborted();
   const wait = Math.max(0, nextAllowed - now());
   if (wait) await sleep(wait, init?.signal);
   init?.signal?.throwIfAborted();
   let units = 1;
   try {
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : null;
    if (Array.isArray(body)) units = Math.max(1, body.length);
   } catch { /* Validation belongs to the RPC handler. */ }
   nextAllowed = now() + interval * units;
   releaseTurn();
   return await request(input, init);
  } finally { releaseTurn(); pending--; }
 };
}
