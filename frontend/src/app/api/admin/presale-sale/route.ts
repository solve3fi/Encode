import { type NextRequest, NextResponse } from "next/server";
import {
	PAYMENT_GRACE_MS,
	SALE_ADMIN_PUBLISH_ACTION,
	SALE_ADMIN_READ_ACTION,
	SALE_ADMIN_SAVE_ACTION,
	validateSaleConfig,
} from "@/configs/presaleSale";
import type { PresaleAllocations } from "@/configs/presaleTypes";
import { readStore, writeStore } from "@/lib/server/dataStore";
import { ROUND2_CLAIM_STORE } from "@/lib/server/presaleClaimRound";
import {
	appendSaleLog,
	saleStatus,
	withSaleLedger,
} from "@/lib/server/presaleSaleStore";
import { requireAdmin } from "@/lib/server/requireAdmin";

export const runtime = "nodejs";

/**
 * Admin > Presale. Both actions are signed by an admin wallet (requireAdmin binds the action, a timestamp and the
 * payload): "save" sets the sale settings, "read" returns the full purchase ledger for review and export.
 */
export async function POST(request: NextRequest) {
	let body: {
		wallet?: string;
		message?: string;
		signature?: string;
		action?: string;
		config?: unknown;
	};
	try {
		body = await request.json();
	} catch {
		return NextResponse.json(
			{ error: "Invalid request body" },
			{ status: 400 },
		);
	}
	const { wallet, message, signature, action } = body;
	if (!wallet || !message || !signature)
		return NextResponse.json({ error: "Missing fields" }, { status: 400 });

	if (action === "save") {
		const validated = validateSaleConfig(body.config);
		if ("error" in validated)
			return NextResponse.json({ error: validated.error }, { status: 400 });
		let admin: string;
		try {
			admin = requireAdmin(
				{ wallet, message, signature },
				SALE_ADMIN_SAVE_ACTION,
				validated.config,
			).toBase58();
		} catch (error) {
			return NextResponse.json(
				{ error: error instanceof Error ? error.message : "Not authorized" },
				{ status: 401 },
			);
		}
		const status = await withSaleLedger(async (state, save) => {
			state.config = validated.config;
			state.configUpdatedBy = admin;
			state.configUpdatedAt = new Date().toISOString();
			await save(state);
			return saleStatus(state, Date.now());
		});
		await appendSaleLog({ event: "config", admin, config: validated.config });
		return NextResponse.json({ status });
	}

	if (action === "read") {
		try {
			requireAdmin({ wallet, message, signature }, SALE_ADMIN_READ_ACTION, {});
		} catch (error) {
			return NextResponse.json(
				{ error: error instanceof Error ? error.message : "Not authorized" },
				{ status: 401 },
			);
		}
		const ledger = await withSaleLedger(async (state) => ({
			status: saleStatus(state, Date.now()),
			configUpdatedBy: state.configUpdatedBy ?? null,
			configUpdatedAt: state.configUpdatedAt ?? null,
			purchases: Object.values(state.purchases).sort((a, b) =>
				a.at.localeCompare(b.at),
			),
		}));
		return NextResponse.json(ledger);
	}

	// Publishes round 2's own claim list (presale-round2-allocations, claimed on /presale) from the sale ledger: one
	// allocation per wallet, summed exactly. Only after the sale is over and no quote can still be paid; it may be
	// republished until the first round-2 claim starts, then it is fixed.
	if (action === "publish-claims") {
		try {
			requireAdmin(
				{ wallet, message, signature },
				SALE_ADMIN_PUBLISH_ACTION,
				{},
			);
		} catch (error) {
			return NextResponse.json(
				{ error: error instanceof Error ? error.message : "Not authorized" },
				{ status: 401 },
			);
		}
		const outcome = await withSaleLedger(async (state) => {
			const now = Date.now();
			const status = saleStatus(state, now);
			const over =
				status.phase === "SOLD_OUT" ||
				(status.phase === "ENDED" &&
					state.config !== null &&
					now > Date.parse(state.config.endsAt) + PAYMENT_GRACE_MS);
			if (!over || status.reservedUsd > 0)
				return { error: "Publish round-2 claims after the sale is over" };
			const existing = await readStore<PresaleAllocations>(
				ROUND2_CLAIM_STORE,
				{},
			);
			if (
				Object.values(existing).some(
					(a) => a.minted || a.locked || a.reservedLockAddress,
				)
			)
				return {
					error:
						"Round-2 claims have started; the claim list can no longer be republished",
				};
			const allocations: PresaleAllocations = {};
			for (const p of Object.values(state.purchases)) {
				const current = allocations[p.wallet];
				const raw = BigInt(current?.amountRaw ?? "0") + BigInt(p.veSolv3Raw);
				allocations[p.wallet] = {
					solanaAddress: p.wallet,
					amountUsd: (current?.amountUsd ?? 0) + p.usd,
					veSolv3Amount: Number(raw / BigInt(1_000_000)) / 1000,
					amountRaw: raw.toString(),
					minted: false,
					locked: false,
				};
			}
			await writeStore(ROUND2_CLAIM_STORE, allocations);
			return {
				wallets: Object.keys(allocations).length,
				totalUsd: Object.values(allocations).reduce(
					(t, a) => t + a.amountUsd,
					0,
				),
			};
		});
		if ("error" in outcome)
			return NextResponse.json({ error: outcome.error }, { status: 409 });
		await appendSaleLog({ event: "round2_claims_published", ...outcome });
		return NextResponse.json(outcome);
	}

	return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
