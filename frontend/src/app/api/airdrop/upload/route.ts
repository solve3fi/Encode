import { createHash } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import type { AirdropAllocations } from "@/configs/airdropTypes";
import { parseAirdropUpload, reconcileAirdropSnapshot, type AirdropSnapshot } from "@/lib/airdropSnapshot";
import { readStore, writeStore } from "@/lib/server/dataStore";
import { requireAdmin } from "@/lib/server/requireAdmin";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
	const formData = await request.formData();
	const wallet = formData.get("wallet");
	const message = formData.get("message");
	const signature = formData.get("signature");
	const file = formData.get("file");
	if (typeof wallet !== "string" || typeof message !== "string" || typeof signature !== "string" || !(file instanceof File)) {
		return NextResponse.json({ error: "Invalid request" }, { status: 400 });
	}
	// Hash before auth-checking so the signature is bound to these exact
	// bytes, and reused below so the file is only read once.
	const fileBytes = new Uint8Array(await file.arrayBuffer());
	const fileHash = createHash("sha256").update(fileBytes).digest("hex");
	try {
		requireAdmin({ wallet, message, signature }, "upload airdrop", {
			fileName: file.name,
			fileHash,
		});
	} catch (error) {
		return NextResponse.json({ error: error instanceof Error ? error.message : "Not authorized" }, { status: 401 });
	}
	if (!/\.(csv|xlsx?)$/i.test(file.name) || file.size > 10 * 1024 * 1024) {
		return NextResponse.json({ error: "Select recipients.csv or the complete seven-tab XLSX/XLS workbook (maximum 10 MB)" }, { status: 400 });
	}
	let snapshot: AirdropSnapshot;
	try {
		snapshot = parseAirdropUpload(fileBytes, file.name);
	} catch (error) {
		return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid spreadsheet" }, { status: 400 });
	}
	const existing = await readStore<AirdropAllocations>("airdrop-allocations", {});
	try {
		// Check claimed allocations for conflicts, but never activate grants here:
		// the current transfer-then-lock flow does not enforce the locked airdrop.
		const result = reconcileAirdropSnapshot(existing, snapshot);
		await writeStore("airdrop-draft", snapshot);
		return NextResponse.json({
			added: result.added, updated: result.updated, removed: result.removed,
			totalAllocations: Object.keys(snapshot.allocations).length,
			totalAmount: snapshot.totalAmount, reservedAmount: snapshot.reservedAmount,
			partners: snapshot.partners, draft: true,
		});
	} catch (error) {
		return NextResponse.json({ error: error instanceof Error ? error.message : "Could not prepare snapshot" }, { status: 409 });
	}
}

export async function GET() {
	const allocations = await readStore<AirdropAllocations>("airdrop-allocations", {});
	const draft = await readStore<AirdropSnapshot | null>("airdrop-draft", null);
	const values = Object.values(allocations);
	return NextResponse.json({
		total: values.length,
		minted: values.filter((a) => a.minted).length,
		locked: values.filter((a) => a.locked).length,
		draft: draft ? { total: Object.keys(draft.allocations).length, totalAmount: draft.totalAmount, reservedAmount: draft.reservedAmount, partners: draft.partners } : null,
	});
}
