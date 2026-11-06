import { NextResponse, type NextRequest } from "next/server";
import { readTokenLogo } from "@/lib/server/tokenLogoStorage";

export const runtime = "nodejs";

// svg deliberately not served (see the note on TOKEN_LOGO_ALLOWED_TYPES) —
// excluding it here too stops any file that predates that restriction from
// still being served as script-capable, same-origin image/svg+xml.
const CONTENT_TYPES: Record<string, string> = {
	png: "image/png",
	jpg: "image/jpeg",
	webp: "image/webp",
};

// Public — this is the live logoURI for both pending (admin-preview) and
// approved (shown app-wide via /api/token-list-extra) submissions, so it
// can't be gated behind admin auth.
export async function GET(
	_request: NextRequest,
	{ params }: { params: Promise<{ filename: string }> },
) {
	const { filename } = await params;
	// Reject path traversal / anything that isn't the flat filename this
	// route ever wrote (see saveTokenLogo's "<mint>-<timestamp>.<ext>" shape).
	if (!/^[A-Za-z0-9]+-\d+\.(png|jpg|webp)$/.test(filename)) {
		return NextResponse.json({ error: "Not found" }, { status: 404 });
	}

	const bytes = await readTokenLogo(filename);
	if (!bytes) {
		return NextResponse.json({ error: "Not found" }, { status: 404 });
	}

	const extension = filename.split(".").pop() ?? "";
	return new NextResponse(new Uint8Array(bytes), {
		headers: {
			"Content-Type": CONTENT_TYPES[extension] ?? "application/octet-stream",
			"Cache-Control": "public, max-age=3600",
		},
	});
}
