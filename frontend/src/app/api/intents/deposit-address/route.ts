import { NextResponse } from "next/server";
import { INTENTS_DESTINATION_SYMBOLS, SOLANA_CHAIN } from "@/configs/intents";
import { isSolanaAddress } from "@/lib/intents/aurora";
import { INTENTS_CHAINS, resolveChain } from "@/lib/intents/chains";
import {
	createPersistentAddress,
	isConfigured,
} from "@/lib/server/auroraIntents";
import { bad, fromError, limit, readJson } from "../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST { depositChain, destinationAsset: "SOL" | "USDC", recipient: <Solana address> }.
 * Returns a persistent deposit address for that person: anything sent to it from `depositChain` is swapped and delivered
 * to `recipient` on Solana. The same address keeps working, so people can top up again later. EVM chains share one address.
 */
export async function POST(request: Request) {
	if (!isConfigured())
		return bad("Cross-chain funding is not available yet.", 503);
	const limited = limit(request, 20);
	if (limited) return limited;
	const body = await readJson(request);
	if (!body) return bad("Send a JSON body.");
	const chain =
		typeof body.depositChain === "string"
			? resolveChain(body.depositChain)
			: null;
	if (!chain || chain.slug === SOLANA_CHAIN) {
		return bad(
			`Pick a source chain: ${INTENTS_CHAINS.filter(
				(c) => c.slug !== SOLANA_CHAIN,
			)
				.map((c) => c.label)
				.join(", ")}.`,
		);
	}
	const asset = String(body.destinationAsset ?? "").toUpperCase();
	if (!(INTENTS_DESTINATION_SYMBOLS as readonly string[]).includes(asset))
		return bad("You can receive SOL or USDC on Solana.");
	const recipient = String(body.recipient ?? "");
	if (!isSolanaAddress(recipient))
		return bad("Connect a Solana wallet to receive funds.");
	try {
		const result = await createPersistentAddress({
			recipient,
			sender: recipient,
			depositChain: chain.slug,
			destinationChain: SOLANA_CHAIN,
			destinationAsset: asset,
		});
		return NextResponse.json({
			depositAddress: result.depositAddress,
			memo: result.memo ?? null,
			alreadyExisted: result.alreadyExists,
			chain: { slug: chain.slug, label: chain.label, network: chain.network },
			destinationAsset: asset,
		});
	} catch (error) {
		return fromError(error);
	}
}
