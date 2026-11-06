import { PublicKey } from "@solana/web3.js";
import { type NextRequest, NextResponse } from "next/server";
import {
	ACCELERATOR_DEFAULT_MAX_EPOCHS,
	ACCELERATOR_PARTNER_ADD_ACTION,
	ACCELERATOR_PARTNER_REMOVE_ACTION,
	ACCELERATOR_PARTNER_UPDATE_ACTION,
	ACCELERATOR_PARTNERS_STORE,
	type AcceleratorPartner,
	type AcceleratorPartnerStatus,
	type AcceleratorPartnersById,
} from "@/configs/acceleratorProgram";
import { readStore, writeStore } from "@/lib/server/dataStore";
import { requireAdmin } from "@/lib/server/requireAdmin";

export const runtime = "nodejs";

const VALID_STATUSES: AcceleratorPartnerStatus[] = [
	"active",
	"completed",
	"removed",
];

// Public read, same convention as the other admin config routes.
export async function GET() {
	const partners = await readStore<AcceleratorPartnersById>(
		ACCELERATOR_PARTNERS_STORE,
		{},
	);
	return NextResponse.json(partners);
}

export async function POST(request: NextRequest) {
	let body: {
		wallet?: string;
		message?: string;
		signature?: string;
		poolAddress?: string;
		projectName?: string;
		enrolledAtEpoch?: number;
		maxEpochs?: number;
		notes?: string;
	};
	try {
		body = await request.json();
	} catch {
		return NextResponse.json(
			{ error: "Invalid request body" },
			{ status: 400 },
		);
	}

	const {
		wallet,
		message,
		signature,
		poolAddress,
		projectName,
		enrolledAtEpoch,
		notes,
	} = body;
	if (
		!wallet ||
		!message ||
		!signature ||
		!poolAddress ||
		!projectName ||
		!enrolledAtEpoch
	) {
		return NextResponse.json({ error: "Missing fields" }, { status: 400 });
	}

	let poolKey: PublicKey;
	try {
		poolKey = new PublicKey(poolAddress);
	} catch {
		return NextResponse.json(
			{ error: "Invalid pool address" },
			{ status: 400 },
		);
	}

	const maxEpochs =
		Number.isFinite(body.maxEpochs) && (body.maxEpochs ?? 0) > 0
			? Math.round(body.maxEpochs as number)
			: ACCELERATOR_DEFAULT_MAX_EPOCHS;

	let adminPublicKey: PublicKey;
	try {
		adminPublicKey = requireAdmin(
			{ wallet, message, signature },
			ACCELERATOR_PARTNER_ADD_ACTION,
			{
				poolAddress,
				projectName,
				enrolledAtEpoch,
				maxEpochs,
				notes: notes ?? "",
			},
		);
	} catch (error) {
		return NextResponse.json(
			{ error: error instanceof Error ? error.message : "Not authorized" },
			{ status: 401 },
		);
	}

	const poolAddressString = poolKey.toString();
	const partners = await readStore<AcceleratorPartnersById>(
		ACCELERATOR_PARTNERS_STORE,
		{},
	);
	if (partners[poolAddressString]?.status === "active") {
		return NextResponse.json(
			{ error: "This pool is already an active accelerator partner" },
			{ status: 409 },
		);
	}

	const now = Date.now();
	const record: AcceleratorPartner = {
		poolAddress: poolAddressString,
		projectName: projectName.trim().slice(0, 64),
		enrolledAtEpoch,
		maxEpochs,
		status: "active",
		notes: notes?.trim().slice(0, 280) || undefined,
		addedBy: adminPublicKey.toString(),
		addedAt: now,
		updatedAt: now,
	};
	partners[poolAddressString] = record;
	await writeStore(ACCELERATOR_PARTNERS_STORE, partners);

	return NextResponse.json({ partner: record });
}

export async function PATCH(request: NextRequest) {
	let body: {
		wallet?: string;
		message?: string;
		signature?: string;
		poolAddress?: string;
		status?: string;
		maxEpochs?: number;
		notes?: string;
	};
	try {
		body = await request.json();
	} catch {
		return NextResponse.json(
			{ error: "Invalid request body" },
			{ status: 400 },
		);
	}

	const { wallet, message, signature, poolAddress, status, maxEpochs, notes } =
		body;
	if (!wallet || !message || !signature || !poolAddress) {
		return NextResponse.json({ error: "Missing fields" }, { status: 400 });
	}
	if (
		status !== undefined &&
		!VALID_STATUSES.includes(status as AcceleratorPartnerStatus)
	) {
		return NextResponse.json({ error: "Invalid status" }, { status: 400 });
	}

	try {
		requireAdmin(
			{ wallet, message, signature },
			ACCELERATOR_PARTNER_UPDATE_ACTION,
			{
				poolAddress,
				status: status ?? "",
				maxEpochs: maxEpochs ?? 0,
				notes: notes ?? "",
			},
		);
	} catch (error) {
		return NextResponse.json(
			{ error: error instanceof Error ? error.message : "Not authorized" },
			{ status: 401 },
		);
	}

	const partners = await readStore<AcceleratorPartnersById>(
		ACCELERATOR_PARTNERS_STORE,
		{},
	);
	const existing = partners[poolAddress];
	if (!existing) {
		return NextResponse.json({ error: "Partner not found" }, { status: 404 });
	}

	if (status) existing.status = status as AcceleratorPartnerStatus;
	if (Number.isFinite(maxEpochs) && (maxEpochs ?? 0) > 0) {
		existing.maxEpochs = Math.round(maxEpochs as number);
	}
	if (notes !== undefined)
		existing.notes = notes.trim().slice(0, 280) || undefined;
	existing.updatedAt = Date.now();
	await writeStore(ACCELERATOR_PARTNERS_STORE, partners);

	return NextResponse.json({ partner: existing });
}

export async function DELETE(request: NextRequest) {
	let body: {
		wallet?: string;
		message?: string;
		signature?: string;
		poolAddress?: string;
	};
	try {
		body = await request.json();
	} catch {
		return NextResponse.json(
			{ error: "Invalid request body" },
			{ status: 400 },
		);
	}

	const { wallet, message, signature, poolAddress } = body;
	if (!wallet || !message || !signature || !poolAddress) {
		return NextResponse.json({ error: "Missing fields" }, { status: 400 });
	}

	try {
		requireAdmin(
			{ wallet, message, signature },
			ACCELERATOR_PARTNER_REMOVE_ACTION,
			{ poolAddress },
		);
	} catch (error) {
		return NextResponse.json(
			{ error: error instanceof Error ? error.message : "Not authorized" },
			{ status: 401 },
		);
	}

	const partners = await readStore<AcceleratorPartnersById>(
		ACCELERATOR_PARTNERS_STORE,
		{},
	);
	delete partners[poolAddress];
	await writeStore(ACCELERATOR_PARTNERS_STORE, partners);

	return NextResponse.json({ ok: true });
}
