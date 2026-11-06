import { type NextRequest, NextResponse } from "next/server";
import {
	PARTNER_APPLICATIONS_STORE,
	type PartnerApplication,
} from "@/configs/partnerApplications";
import { readStore, writeStore } from "@/lib/server/dataStore";

export const runtime = "nodejs";

const STORE = PARTNER_APPLICATIONS_STORE;
const MAX_STORED = 2_000;

const clean = (value: unknown, max: number) =>
	typeof value === "string" ? value.trim().slice(0, max) : "";

// Public pilot request from /partners. Nothing here grants access to anything;
// the team reviews each application by hand.
export async function POST(request: NextRequest) {
	let body: Record<string, unknown>;
	try {
		body = (await request.json()) as Record<string, unknown>;
	} catch {
		return NextResponse.json({ error: "Invalid request" }, { status: 400 });
	}

	const project = clean(body.project, 80);
	const pair = clean(body.pair, 60);
	const mint = clean(body.mint, 64);
	const contact = clean(body.contact, 120);
	if (!project || !contact) {
		return NextResponse.json(
			{ error: "Project name and a contact are required" },
			{ status: 400 },
		);
	}

	const stored = await readStore<PartnerApplication[]>(STORE, []);
	const recent = stored.find(
		(item) =>
			item.contact.toLowerCase() === contact.toLowerCase() &&
			Date.now() - item.submittedAt < 60 * 60 * 1000,
	);
	if (recent) {
		return NextResponse.json(
			{ error: "We already have a request from this contact. We'll be in touch." },
			{ status: 429 },
		);
	}

	stored.push({
		project,
		pair,
		mint,
		contact,
		...(body.accelerator === "yes" ? { accelerator: true } : {}),
		submittedAt: Date.now(),
	});
	await writeStore(STORE, stored.slice(-MAX_STORED));
	return NextResponse.json({ ok: true });
}
