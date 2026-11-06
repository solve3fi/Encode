import { PublicKey } from "@solana/web3.js";
import { type NextRequest, NextResponse } from "next/server";
import {
	DEFAULT_VESOLV3_USD,
	EMPTY_LP_INCENTIVES_CONFIG,
	LP_INCENTIVE_REMOVE_ACTION,
	LP_INCENTIVE_SET_ACTION,
	LP_INCENTIVE_SETTINGS_ACTION,
	LP_INCENTIVES_STORE,
	type LpIncentivePool,
	type LpIncentivesConfig,
	type LpIncentiveStatus,
	MAX_FEE_SHARE_BPS,
	MAX_MULTIPLIER,
} from "@/configs/lpIncentives";
import { readStore, writeStore } from "@/lib/server/dataStore";
import { requireAdmin } from "@/lib/server/requireAdmin";

export const runtime = "nodejs";

const VALID_STATUSES: LpIncentiveStatus[] = ["active", "paused", "ended"];

const readConfig = () =>
	readStore<LpIncentivesConfig>(LP_INCENTIVES_STORE, EMPTY_LP_INCENTIVES_CONFIG);

// Public read, same convention as the other admin config routes: the pool
// list needs the incentive parameters to show the Bonus APR column.
export async function GET() {
	return NextResponse.json(await readConfig());
}

type Body = {
	wallet?: string;
	message?: string;
	signature?: string;
	action?: string;
	poolAddress?: string;
	feeShareBps?: number;
	multiplier?: number;
	weeklyCapSolv3?: number | null;
	status?: LpIncentiveStatus;
	notes?: string;
	veSolv3Usd?: number;
};

const isFiniteNumber = (value: unknown): value is number =>
	typeof value === "number" && Number.isFinite(value);

export async function POST(request: NextRequest) {
	let body: Body;
	try {
		body = await request.json();
	} catch {
		return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
	}
	const { wallet, message, signature, action } = body;
	if (!wallet || !message || !signature || !action) {
		return NextResponse.json({ error: "Missing fields" }, { status: 400 });
	}

	try {
		const config = await readConfig();
		const now = Date.now();

		if (action === LP_INCENTIVE_SETTINGS_ACTION) {
			const { veSolv3Usd } = body;
			if (!isFiniteNumber(veSolv3Usd) || veSolv3Usd <= 0) {
				return NextResponse.json({ error: "Invalid veSOLV3 price" }, { status: 400 });
			}
			const admin = requireAdmin({ wallet, message, signature }, action, { veSolv3Usd });
			const next: LpIncentivesConfig = {
				...config,
				veSolv3Usd,
				updatedBy: admin.toBase58(),
				updatedAt: now,
			};
			await writeStore(LP_INCENTIVES_STORE, next);
			return NextResponse.json(next);
		}

		const { poolAddress } = body;
		if (!poolAddress) {
			return NextResponse.json({ error: "Missing pool address" }, { status: 400 });
		}
		let poolKey: PublicKey;
		try {
			poolKey = new PublicKey(poolAddress);
		} catch {
			return NextResponse.json({ error: "Invalid pool address" }, { status: 400 });
		}
		const pool = poolKey.toBase58();

		if (action === LP_INCENTIVE_REMOVE_ACTION) {
			requireAdmin({ wallet, message, signature }, action, { poolAddress: pool });
			if (!config.pools[pool]) {
				return NextResponse.json({ error: "Pool is not incentivized" }, { status: 404 });
			}
			const { [pool]: _removed, ...pools } = config.pools;
			const next: LpIncentivesConfig = { ...config, pools, updatedAt: now };
			await writeStore(LP_INCENTIVES_STORE, next);
			return NextResponse.json(next);
		}

		if (action === LP_INCENTIVE_SET_ACTION) {
			const { feeShareBps, multiplier, status, notes } = body;
			const weeklyCapSolv3 = body.weeklyCapSolv3 ?? undefined;
			if (
				!Number.isInteger(feeShareBps) ||
				(feeShareBps as number) < 0 ||
				(feeShareBps as number) > MAX_FEE_SHARE_BPS
			) {
				return NextResponse.json({ error: "Invalid fee share" }, { status: 400 });
			}
			if (!isFiniteNumber(multiplier) || multiplier < 0 || multiplier > MAX_MULTIPLIER) {
				return NextResponse.json({ error: "Invalid multiplier" }, { status: 400 });
			}
			if (weeklyCapSolv3 !== undefined && (!isFiniteNumber(weeklyCapSolv3) || weeklyCapSolv3 < 0)) {
				return NextResponse.json({ error: "Invalid weekly cap" }, { status: 400 });
			}
			if (!status || !VALID_STATUSES.includes(status)) {
				return NextResponse.json({ error: "Invalid status" }, { status: 400 });
			}
			const payload = {
				poolAddress: pool,
				feeShareBps,
				multiplier,
				weeklyCapSolv3: weeklyCapSolv3 ?? null,
				status,
				notes: notes ?? "",
			};
			const admin = requireAdmin({ wallet, message, signature }, action, payload);
			const entry: LpIncentivePool = {
				poolAddress: pool,
				feeShareBps: feeShareBps as number,
				multiplier,
				...(weeklyCapSolv3 !== undefined ? { weeklyCapSolv3 } : {}),
				status,
				...(notes ? { notes } : {}),
				updatedBy: admin.toBase58(),
				updatedAt: now,
			};
			const next: LpIncentivesConfig = {
				...config,
				veSolv3Usd: config.veSolv3Usd || DEFAULT_VESOLV3_USD,
				pools: { ...config.pools, [pool]: entry },
				updatedBy: admin.toBase58(),
				updatedAt: now,
			};
			await writeStore(LP_INCENTIVES_STORE, next);
			return NextResponse.json(next);
		}

		return NextResponse.json({ error: "Unknown action" }, { status: 400 });
	} catch (error) {
		const messageText = error instanceof Error ? error.message : "Unauthorized";
		return NextResponse.json({ error: messageText }, { status: 401 });
	}
}
