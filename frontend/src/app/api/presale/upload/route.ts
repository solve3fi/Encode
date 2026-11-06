import { createHash } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import type { PresaleAllocations } from "@/configs/presaleTypes";
import { parsePresaleUpload, reconcilePresaleSnapshot, type PresaleSnapshot } from "@/lib/presaleSnapshot";
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

	const fileBytes = new Uint8Array(await file.arrayBuffer());
	const fileHash = createHash("sha256").update(fileBytes).digest("hex");
	try {
		requireAdmin({ wallet, message, signature }, "upload presale allocations", {
			fileName: file.name,
			fileHash,
		});
	} catch (error) {
		return NextResponse.json({ error: error instanceof Error ? error.message : "Not authorized" }, { status: 401 });
	}

	if (!/\.(csv|xlsx?)$/i.test(file.name) || file.size > 10 * 1024 * 1024) {
		return NextResponse.json({ error: "Select a CSV or XLSX file (maximum 10 MB)" }, { status: 400 });
	}
	let snapshot: PresaleSnapshot;
	try {
		snapshot = parsePresaleUpload(fileBytes, file.name);
	} catch (error) {
		return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid spreadsheet" }, { status: 400 });
	}
	const existing = await readStore<PresaleAllocations>("presale-allocations", {});
	try {
		// Check claimed allocations for conflicts, but never activate grants here.
		const result = reconcilePresaleSnapshot(existing, snapshot);
		await writeStore("presale-draft", snapshot);
		return NextResponse.json({
			added: result.added, updated: result.updated, removed: result.removed,
			totalAllocations: Object.keys(snapshot.allocations).length,
			totalUsd: snapshot.totalUsd, totalVeSolv3: snapshot.totalVeSolv3,
			draft: true,
		});
	} catch (error) {
		return NextResponse.json({ error: error instanceof Error ? error.message : "Could not prepare snapshot" }, { status: 409 });
	}
}

export async function GET() {
	const allocations = await readStore<PresaleAllocations>("presale-allocations", {});
	const draft = await readStore<PresaleSnapshot | null>("presale-draft", null);
	const values = Object.values(allocations);
	return NextResponse.json({
		total: values.length,
		minted: values.filter((a) => a.minted).length,
		locked: values.filter((a) => a.locked).length,
		draft: draft ? { total: Object.keys(draft.allocations).length, totalUsd: draft.totalUsd, totalVeSolv3: draft.totalVeSolv3 } : null,
	});
}
