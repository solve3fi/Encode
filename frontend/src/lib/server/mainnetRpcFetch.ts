export const PUBLIC_MAINNET_RPC = "https://api.mainnet-beta.solana.com";
export const PUBLIC_DEVNET_RPC = "https://api.devnet.solana.com";
export const DEVNET_GENESIS_HASH = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
export type RpcFetch = (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => ReturnType<typeof fetch>;

/** Preserve RPC payloads/commitments; bypass an unavailable provider briefly. */
export function createRpcFetch(
	primary: string,
	network: "mainnet-beta" | "devnet",
	request: RpcFetch = globalThis.fetch,
	now: () => number = Date.now,
): RpcFetch {
	const fallback = network === "devnet" ? PUBLIC_DEVNET_RPC : network === "mainnet-beta" ? PUBLIC_MAINNET_RPC : undefined;
	if (!fallback) throw new Error("Unsupported RPC network");
	let retryPrimaryAt = 0;
	let verifiedPrimary: Promise<void> | undefined;
	const call = async (url: string, init?: RequestInit, fallback = false) => {
		const headers = new Headers(init?.headers);
		if (fallback) {
			for (const name of ["authorization", "cookie", "x-api-key"]) headers.delete(name);
		}
		return request(url, {
			...init,
			headers,
			redirect: "error",
			signal: AbortSignal.any([
				...(init?.signal ? [init.signal] : []),
				AbortSignal.timeout(8_000),
			]),
		});
	};
	return async (_input, init) => {
		if (primary === fallback) return call(primary, init, true);
		if (now() >= retryPrimaryAt) {
			try {
				// A misplaced runtime URL must never send Devnet payloads to Mainnet.
				if (network === "devnet") {
					verifiedPrimary ??= (async () => {
						const probe = await call(primary, {
							method: "POST", headers: { "Content-Type": "application/json" },
							body: JSON.stringify({ jsonrpc: "2.0", id: "network-check", method: "getGenesisHash", params: [] }),
						});
						if (!probe.ok || (await probe.json()).result !== DEVNET_GENESIS_HASH)
							throw new Error("Devnet RPC identity could not be verified");
					})().catch((error) => { verifiedPrimary = undefined; throw error; });
					await verifiedPrimary;
				}
				const response = await call(primary, init);
				let unavailable = [401, 403, 429].includes(response.status) || response.status >= 500;
				if (response.ok) {
					const body = await response.clone().json().catch(() => null);
					const replies = Array.isArray(body) ? body : [body];
					unavailable = replies.some((reply) => [-32005, -32429, 429].includes(reply?.error?.code));
				}
				if (!unavailable) return response;
				await response.body?.cancel();
			} catch (error) {
				if (init?.signal?.aborted || (error instanceof Error && error.name === "RpcQueueFullError")) throw error;
			}
			retryPrimaryAt = now() + 30_000;
		}
		return call(fallback, init, true);
	};
}

/** Compatibility entry point for mainnet callers. */
export function createMainnetRpcFetch(primary: string, request: RpcFetch = globalThis.fetch, now: () => number = Date.now): RpcFetch {
	return createRpcFetch(primary, "mainnet-beta", request, now);
}
