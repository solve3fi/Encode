"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useQuestSession } from "@/components/QuestTest/QuestSessionProvider";

export type ClanMember = {
	ref: string;
	alias: string;
	role: "LEADER" | "MEMBER";
	xp: number;
	weekXp: number;
	joinedAt: string;
	isMe: boolean;
};

export type Rally = { gauge: string; pool: string; label: string; since: string; backed: number | null; members: number };

export type MyClan = {
	id: string;
	name: string;
	tag: string;
	role: "LEADER" | "MEMBER";
	myRef: string;
	createdAt: string;
	rank: number;
	members: number;
	activeMembers: number;
	seasonXp: number;
	weekXp: number;
	score: number;
	perActive: number;
	membersList: ClanMember[];
	invite: string | null;
	voting: { epoch: number; voted: number; members: number } | null;
	rallies: Rally[];
};

export type ClanOverview = {
	eligible: boolean;
	maxMembers: number;
	clanCount: number;
	season: { key: string; label: string; startsAt: string; endsAt: string } | null;
	clan: MyClan | null;
};

export type BoardClan = {
	id: string;
	name: string;
	tag: string;
	rank: number;
	members: number;
	maxMembers: number;
	score: number;
	weekXp: number;
	perActive: number;
	isMine: boolean;
};

export type ClanBoard = { total: number; clans: BoardClan[] };

type Reply = { result?: string; overview?: ClanOverview; board?: ClanBoard };
type Api = { clans(action: string, params?: Record<string, unknown>): Promise<Reply> };

/** What the server says about a write, in words a person can act on. */
export const CLAN_MESSAGES: Record<string, string> = {
	INVALID: "That doesn't look right. Names are 3 to 24 letters or numbers; tags are 3 or 4 letters or numbers.",
	NOT_ELIGIBLE: "Mint your Solve3 Pass, or vote with a veSOLV3 lock, to join a clan.",
	ALREADY_IN_CLAN: "You are already in a clan. Leave it first to join another.",
	COOLDOWN: "You left a clan recently. Try again in about an hour.",
	NAME_TAKEN: "A clan with that name already exists.",
	TAG_TAKEN: "That tag is taken.",
	FULL: "That clan is full.",
	NOT_FOUND: "We couldn't find that clan or invite. It may have expired.",
	FORBIDDEN: "Only the clan leader can do that.",
	NOT_IN_CLAN: "You are not in a clan.",
	LIMIT: "A clan can rally up to three pools. Remove one first.",
	EXISTS: "Your clan is already rallying that pool.",
};

/**
 * Clans for the signed-in Passport. Reads load only once the quest session is signed in (READY), so a visitor who has
 * not signed in never triggers a wallet prompt. Every rule is enforced by the server; this only presents it.
 */
export const useClans = (skip = false) => {
	const { client, state } = useQuestSession();
	const api = client as unknown as Api | null;
	const ready = (state as { status: string }).status === "READY";
	const active = ready && !skip;
	const [overview, setOverview] = useState<ClanOverview | null>(null);
	const [board, setBoard] = useState<ClanBoard | null>(null);
	const [loading, setLoading] = useState(false);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const query = useRef("");

	const loadBoard = useCallback(
		async (q = query.current) => {
			if (!api) return;
			query.current = q;
			const reply = await api.clans("board", { query: q, limit: 20, offset: 0 });
			if (reply.board) setBoard(reply.board);
		},
		[api],
	);

	const refresh = useCallback(async () => {
		if (!api) return;
		setLoading(true);
		try {
			const reply = await api.clans("overview");
			if (reply.overview) setOverview(reply.overview);
			await loadBoard();
			setError(null);
		} catch {
			setError("Could not load clans. Try again in a moment.");
		} finally {
			setLoading(false);
		}
	}, [api, loadBoard]);

	useEffect(() => {
		if (active) void refresh();
		else if (!skip) {
			setOverview(null);
			setBoard(null);
			setError(null);
		}
	}, [active, skip, refresh]);

	/** Run a write. Returns the server's result word (OK, NAME_TAKEN, ...) or undefined if the call failed. */
	const act = useCallback(
		async (action: string, params: Record<string, unknown> = {}): Promise<string | undefined> => {
			if (!api) return undefined;
			setBusy(true);
			setError(null);
			try {
				const reply = await api.clans(action, params);
				if (reply.overview) setOverview(reply.overview);
				await loadBoard();
				return reply.result;
			} catch {
				setError("That didn't go through. Check your connection and try again.");
				return undefined;
			} finally {
				setBusy(false);
			}
		},
		[api, loadBoard],
	);

	const search = useCallback(
		async (q: string) => {
			try {
				await loadBoard(q.trim().slice(0, 24));
			} catch {
				setError("Could not search clans.");
			}
		},
		[loadBoard],
	);

	return { ready, overview, board, loading, busy, error, refresh, act, search };
};
