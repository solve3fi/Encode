import { type NextRequest, NextResponse } from "next/server";
import {
	isQuestPauseKey,
	QUEST_PAUSE_REASON_MAX,
	QUEST_PAUSE_SET_ACTION,
	QUEST_PAUSES_READ_ACTION,
	type QuestPauseStatus,
	questPauseSetPayload,
} from "@/configs/questPauses";
import { requireAdmin } from "@/lib/server/requireAdmin";
import { createQuestPauseGateway } from "../../../../../scripts/quest/quest-pause-gateway.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The gateway is plain JavaScript, so its result shape is stated here.
type GatewayResult =
	| { ok: true; status: 200; pauses: QuestPauseStatus; result: unknown }
	| { ok: false; status: number; error: string };

type Body = {
	action?: unknown;
	wallet?: string;
	message?: string;
	signature?: string;
	key?: unknown;
	paused?: unknown;
	reason?: unknown;
};

// The Quest emergency stops. A signed admin request is verified here, then forwarded server-to-server to
// the Quest backend with a shared token; the browser never talks to the backend and never sees the token.
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

	const gateway = createQuestPauseGateway({
		// The backend's private Docker-network address (http://quest-backend:8080); its public origin does not route this path.
		backendOrigin: process.env.QUEST_PAUSE_BACKEND_ORIGIN,
		token: process.env.QUEST_PAUSE_ADMIN_TOKEN,
	});
	if (!gateway.configured()) {
		return NextResponse.json(
			{ error: "Quest controls are not configured on this server" },
			{ status: 503 },
		);
	}

	if (body.action === "read") {
		try {
			requireAdmin(
				{ wallet, message, signature },
				QUEST_PAUSES_READ_ACTION,
				{},
			);
		} catch (error) {
			return NextResponse.json(
				{ error: error instanceof Error ? error.message : "Not authorized" },
				{ status: 401 },
			);
		}
		const result = (await gateway.read()) as GatewayResult;
		return result.ok
			? NextResponse.json({ pauses: result.pauses })
			: NextResponse.json(
					{ error: "Quest controls are unavailable" },
					{ status: 503 },
				);
	}

	if (body.action === "set") {
		if (
			!isQuestPauseKey(body.key) ||
			typeof body.paused !== "boolean" ||
			typeof body.reason !== "string" ||
			body.reason.length > QUEST_PAUSE_REASON_MAX ||
			(body.paused && body.reason.trim().length === 0)
		) {
			return NextResponse.json(
				{
					error:
						"Choose a switch and, when pausing, give a reason of up to 200 characters",
				},
				{ status: 400 },
			);
		}
		const payload = questPauseSetPayload(body.key, body.paused, body.reason);
		let admin: string;
		try {
			admin = requireAdmin(
				{ wallet, message, signature },
				QUEST_PAUSE_SET_ACTION,
				payload,
			).toString();
		} catch (error) {
			return NextResponse.json(
				{ error: error instanceof Error ? error.message : "Not authorized" },
				{ status: 401 },
			);
		}
		const result = (await gateway.set({
			key: payload.key,
			paused: payload.paused,
			reason: payload.reason,
			actor: admin,
		})) as GatewayResult;
		if (result.ok) {
			return NextResponse.json({
				pauses: result.pauses,
				result: result.result,
			});
		}
		return NextResponse.json(
			{
				error:
					result.status === 400
						? "The change was refused"
						: "Quest controls are unavailable",
			},
			{ status: result.status },
		);
	}

	return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
