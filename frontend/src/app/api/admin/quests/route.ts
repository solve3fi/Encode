import { type NextRequest, NextResponse } from "next/server";
import { isQuestAdminAction, QUEST_ADMIN_ACTIONS } from "@/configs/questAdmin";
import { requireAdmin } from "@/lib/server/requireAdmin";
import { createQuestAdminGateway } from "../../../../../scripts/quest/quest-admin-gateway.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type GatewayResult =
	| { ok: true; status: 200; data: Record<string, unknown> }
	| { ok: false; status: number; error: string; detail?: string };

type Body = {
	action?: unknown;
	wallet?: string;
	message?: string;
	signature?: string;
	params?: unknown;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

// The Quest calendar and the manual community goals. A signed admin request is verified here (the signature binds
// the action and the exact parameters), then forwarded server-to-server to the Quest backend with a shared token
// and the verified wallet as the actor; the browser never talks to the backend and never sees the token.
export async function POST(request: NextRequest) {
	let body: Body;
	try {
		body = (await request.json()) as Body;
	} catch {
		return NextResponse.json(
			{ error: "Invalid request body" },
			{ status: 400 },
		);
	}
	const { wallet, message, signature } = body;
	if (!wallet || !message || !signature) {
		return NextResponse.json({ error: "Missing fields" }, { status: 400 });
	}

	const gateway = createQuestAdminGateway({
		// The backend's private Docker-network address (http://quest-backend:8080); its public origin does not route /admin/*.
		backendOrigin: process.env.QUEST_PAUSE_BACKEND_ORIGIN,
		token: process.env.QUEST_ADMIN_TOKEN,
	});
	if (!gateway.configured()) {
		return NextResponse.json(
			{ error: "Quest controls are not configured on this server" },
			{ status: 503 },
		);
	}

	if (!isQuestAdminAction(body.action) || !isRecord(body.params)) {
		return NextResponse.json({ error: "Unknown action" }, { status: 400 });
	}
	const action = body.action;
	let admin: string;
	try {
		admin = requireAdmin(
			{ wallet, message, signature },
			QUEST_ADMIN_ACTIONS[action],
			body.params,
		).toString();
	} catch (error) {
		return NextResponse.json(
			{ error: error instanceof Error ? error.message : "Not authorized" },
			{ status: 401 },
		);
	}

	const result = (await gateway.send({
		// The verified action and wallet come last so signed parameters can never override them.
		...body.params,
		action,
		...(action === "overview" || action === "leads" ? {} : { actor: admin }),
	})) as GatewayResult;
	if (result.ok) return NextResponse.json(result.data);
	return NextResponse.json(
		{
			error:
				result.status === 400
					? "The change was refused"
					: result.status === 409
						? "The calendar changed since you loaded it"
						: "Quest controls are unavailable",
			...(result.detail ? { detail: result.detail } : {}),
		},
		{ status: result.status },
	);
}
