const uuid =
	/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const fail = () => {
	throw new Error("UNAVAILABLE");
};
export function checkWalletChallenge(
	value,
	{ wallet, origin, nowMs = Date.now() },
) {
	const lines = value?.message?.split("\n");
	if (
		lines?.length !== 9 ||
		lines[0] !== "solve3 passport authentication v1" ||
		lines[1] !== "network: DEVNET" ||
		lines[2] !== `domain: ${new URL(origin).host}` ||
		lines[3] !== "action: passport.authenticate" ||
		!uuid.test(lines[4].slice(10)) ||
		lines[4] !== `passport: ${lines[4].slice(10)}` ||
		lines[5] !== `wallet: ${wallet}` ||
		!/^nonce: [A-Za-z0-9_-]{43}$/.test(lines[6]) ||
		value.network !== "DEVNET"
	)
		fail();
	const issued = Date.parse(lines[7].slice(10)),
		expires = Date.parse(lines[8].slice(11));
	if (
		lines[7] !== `issuedAt: ${new Date(issued).toISOString()}` ||
		lines[8] !== `expiresAt: ${new Date(expires).toISOString()}` ||
		value.expiresAt !== lines[8].slice(11) ||
		issued > nowMs ||
		expires <= nowMs ||
		expires - issued > 300000
	)
		fail();
	return lines[4].slice(10);
}
function checkPersonal(snapshot, history, passportId) {
	if (
		snapshot?.passportId !== passportId ||
		history?.passportId !== passportId ||
		snapshot.awardEligible !== false ||
		history.awardEligible !== false ||
		snapshot.fixtureKind !== "SYNTHETIC_DEVNET" ||
		history.fixtureKind !== "SYNTHETIC_DEVNET" ||
		snapshot.campaignId !== history.campaignId ||
		!Array.isArray(history.receipts) ||
		history.receipts.length > 25 ||
		(snapshot.weekly !== null &&
			(snapshot.weekly?.quests?.length !== 3 ||
				snapshot.weekly.awardEligible !== false)) ||
		!Array.isArray(snapshot.communityGoals) ||
		!Array.isArray(snapshot.milestones)
	)
		fail();
	for (const r of history.receipts)
		if (
			r.awardEligible !== false ||
			r.fixtureKind !== "SYNTHETIC_DEVNET" ||
			r.state !== "RESERVED_TEST_ONLY" ||
			!Number.isSafeInteger(r.testXp) ||
			r.testXp < 1 ||
			typeof r.completionKey !== "string"
		)
			fail();
}

/** Browser-only controller. CSRF remains in memory; cookies stay HttpOnly.
 * No Node modules, localStorage, signature logging or live XP aggregation.
 * @param {{origin:string,campaignId:string,fetchImpl?:typeof fetch,onChange?:(state:object)=>void}} config */
export function createQuestBrowserClient({
	origin,
	campaignId,
	fetchImpl = fetch,
	onChange = () => {},
}) {
	if (
		new URL(origin).protocol !== "https:" ||
		!/^[a-z0-9][a-z0-9-]{0,63}$/.test(campaignId)
	)
		fail();
	let identity = { wallet: null, network: null },
		generation = 0,
		controller,
		csrf = null,
		passportId = null;
	let state = {
		status: "DISCONNECTED",
		snapshot: null,
		history: null,
		xp: null,
		error: null,
	};
	const emit = (patch) => {
		state = { ...state, ...patch };
		onChange(state);
	};
	async function post(scope, operation, input, signal) {
		const response = await fetchImpl(`/api/quest-test/${scope}/${operation}`, {
			method: "POST",
			credentials: "same-origin",
			cache: "no-store",
			redirect: "error",
			headers: {
				"Content-Type": "application/json",
				...(csrf ? { "X-Solve3-CSRF": csrf } : {}),
			},
			body: JSON.stringify(input),
			signal,
		});
		const value = await response.json();
		if (!response.ok)
			throw new Error(
				["UNAUTHORIZED", "FORBIDDEN", "RATE_LIMITED"].includes(value?.error)
					? value.error
					: "UNAVAILABLE",
			);
		return value;
	}
	function begin() {
		controller?.abort();
		controller = new AbortController();
		return { version: generation, signal: controller.signal };
	}
	function current(job) {
		return job.version === generation && !job.signal.aborted;
	}
	function failure(job, e) {
		if (!current(job)) return;
		if (["UNAUTHORIZED", "FORBIDDEN"].includes(e?.message)) {
			csrf = null;
			passportId = null;
		}
		emit({
			status: "ERROR",
			snapshot: null,
			history: null,
			xp: null,
			error: ["UNAUTHORIZED", "FORBIDDEN", "RATE_LIMITED"].includes(e?.message)
				? e.message
				: "UNAVAILABLE",
		});
	}
	// Voting XP rides along with the XP read. A malformed or missing section is shown as unavailable
	// and never takes the Quest XP down with it.
	function readVoting(value) {
		const ok =
			value &&
			value.testOnly === true &&
			Number.isSafeInteger(value.votingXp) &&
			value.votingXp >= 0 &&
			Number.isSafeInteger(value.xpPerEpoch) &&
			value.xpPerEpoch > 0 &&
			(value.currentEpoch === null || Number.isSafeInteger(value.currentEpoch)) &&
			typeof value.votedThisEpoch === "boolean" &&
			Array.isArray(value.recentEpochs) &&
			value.recentEpochs.length <= 8 &&
			value.recentEpochs.every(
				(entry) => Number.isSafeInteger(entry?.epoch) && entry.earned === true,
			);
		return ok
			? {
					testOnly: true,
					votingXp: value.votingXp,
					xpPerEpoch: value.xpPerEpoch,
					currentEpoch: value.currentEpoch,
					votedThisEpoch: value.votedThisEpoch,
					recentEpochs: value.recentEpochs.map(({ epoch }) => ({ epoch, earned: true })),
				}
			: null;
	}
	// Community goals (completed by hand) ride along too; a bad section is simply absent.
	function readCommunity(value) {
		if (!Array.isArray(value) || value.length > 24) return [];
		const ok = value.every(
			(g) =>
				typeof g?.id === "string" &&
				typeof g.title === "string" &&
				typeof g.flavorText === "string" &&
				typeof g.startsAt === "string" &&
				typeof g.endsAt === "string" &&
				Number.isSafeInteger(g.xp) &&
				["UPCOMING", "ACTIVE", "EXPIRED", "COMPLETED"].includes(g.status) &&
				(g.completedAt === null || typeof g.completedAt === "string") &&
				typeof g.received === "boolean",
		);
		return ok
			? value.map((g) => ({
					id: g.id,
					title: g.title,
					flavorText: g.flavorText,
					startsAt: g.startsAt,
					endsAt: g.endsAt,
					xp: g.xp,
					status: g.status,
					completedAt: g.completedAt,
					received: g.received,
				}))
			: [];
	}
	// Social quests ride along with the XP read; a bad section is simply absent.
	function readSocial(value) {
		const ok =
			Array.isArray(value) &&
			value.length <= 6 &&
			value.every(
				(q) =>
					["follow-x", "post-x", "join-discord"].includes(q?.key) &&
					typeof q.title === "string" &&
					typeof q.description === "string" &&
					Number.isSafeInteger(q.xp) &&
					q.xp > 0 &&
					typeof q.actionLabel === "string" &&
					typeof q.actionUrl === "string" &&
					/^https:\/\//.test(q.actionUrl) &&
					(q.postText === null || typeof q.postText === "string") &&
					(q.claimedAt === null || typeof q.claimedAt === "string"),
			);
		return ok
			? value.map((q) => ({
					key: q.key,
					title: q.title,
					description: q.description,
					xp: q.xp,
					actionLabel: q.actionLabel,
					actionUrl: q.actionUrl,
					postText: q.postText,
					claimedAt: q.claimedAt,
				}))
			: null;
	}
	// Partner Scout rides along with the XP read; a bad section is simply absent.
	function readPartnerScout(value) {
		const ok =
			value &&
			Number.isSafeInteger(value.bountyXp) &&
			value.bountyXp > 0 &&
			Number.isSafeInteger(value.weeklyLimit) &&
			Number.isSafeInteger(value.remainingThisWeek) &&
			value.remainingThisWeek >= 0 &&
			Array.isArray(value.leads) &&
			value.leads.length <= 20 &&
			value.leads.every(
				(l) =>
					typeof l?.name === "string" &&
					typeof l.url === "string" &&
					["SUBMITTED", "REJECTED", "ONBOARDED"].includes(l.status) &&
					typeof l.submittedAt === "string" &&
					(l.note === null || typeof l.note === "string"),
			);
		return ok
			? {
					bountyXp: value.bountyXp,
					weeklyLimit: value.weeklyLimit,
					remainingThisWeek: value.remainingThisWeek,
					leads: value.leads.map((l) => ({
						name: l.name,
						url: l.url,
						status: l.status,
						submittedAt: l.submittedAt,
						note: l.note,
					})),
				}
			: null;
	}
	// Devnet test XP is a secondary read: a failure or an unexpected shape leaves it unavailable
	// instead of failing the whole panel.
	function readXp(value) {
		const ok =
			value &&
			value.testOnly === true &&
			value.campaignId === campaignId &&
			value.passportId === passportId &&
			Number.isSafeInteger(value.totalXp) &&
			value.totalXp >= 0 &&
			Array.isArray(value.onboarding) &&
			value.onboarding.length <= 4 &&
			value.onboarding.every(
				(q) =>
					typeof q?.id === "string" &&
					typeof q.title === "string" &&
					typeof q.description === "string" &&
					Number.isSafeInteger(q.xp) &&
					typeof q.completed === "boolean" &&
					(q.awardedAt === null || typeof q.awardedAt === "string"),
			);
		const profile = value?.leaderboard;
		const leaderboard = profile && typeof profile.publicId === "string" && /^[0-9a-f-]{36}$/.test(profile.publicId)
			&& profile.label === `Explorer ${profile.publicId.replaceAll("-", "").slice(0, 8).toUpperCase()}`
			&& (profile.rank === null || (Number.isSafeInteger(profile.rank) && profile.rank >= 1 && profile.rank <= 50))
			? { publicId: profile.publicId, label: profile.label, rank: profile.rank } : null;
		return ok
			? { ...value, leaderboard, voting: readVoting(value.voting), community: readCommunity(value.community), partnerScout: readPartnerScout(value.partnerScout), social: readSocial(value.social) }
			: null;
	}
	// Referral reads/writes are on-demand and never touch the panel state. A bad shape is refused.
	function readReferral(value) {
		const ok =
			value &&
			value.testOnly === true &&
			value.campaignId === campaignId &&
			value.passportId === passportId &&
			/^[A-HJ-NP-Z2-9]{8}$/.test(value.code) &&
			Number.isSafeInteger(value.ratePercent) &&
			Number.isSafeInteger(value.maxReferrals) &&
			Number.isSafeInteger(value.referredCount) &&
			Number.isSafeInteger(value.bonusXp) &&
			value.bonusXp >= 0 &&
			typeof value.referredBy === "boolean" &&
			(value.result === undefined ||
				["OK", "INVALID", "SELF", "ALREADY", "CYCLE", "FULL"].includes(value.result));
		if (!ok) fail();
		return value;
	}
	async function load(job) {
		const xpRead = post("calendar", "xp", { campaignId }, job.signal)
			.then(readXp)
			.catch(() => null);
		const [snapshot, history] = await Promise.all([
			post("calendar", "snapshot", { campaignId }, job.signal),
			post(
				"calendar",
				"history",
				{ campaignId, before: null, limit: 25 },
				job.signal,
			),
		]);
		if (!current(job)) return;
		checkPersonal(snapshot, history, passportId);
		if (snapshot.campaignId !== campaignId) fail();
		emit({ status: "READY", snapshot, history, xp: await xpRead, error: null });
	}
	return {
		getState: () => state,
		async connect(signMessage) {
			if (!identity.wallet || identity.network !== "devnet") return;
			const job = begin(),
				wallet = identity.wallet;
			emit({ status: "LOADING", snapshot: null, history: null, xp: null, error: null });
			try {
				const session = await post("passport", "resume", {}, job.signal);
				if (!current(job)) return;
				if (session.wallet !== wallet) {
					csrf = null;
					passportId = null;
					await this.signIn(signMessage);
					return;
				}
				if (
					session.network !== "DEVNET" ||
					session.wallet !== wallet ||
					!uuid.test(session.passportId) ||
					!/^[A-Za-z0-9_-]{43}$/.test(session.csrfToken ?? "") ||
					!Number.isFinite(Date.parse(session.expiresAt)) ||
					Date.parse(session.expiresAt) <= Date.now()
				)
					fail();
				csrf = session.csrfToken;
				passportId = session.passportId;
				await load(job);
			} catch (e) {
				if (!current(job)) return;
				if (["UNAUTHORIZED", "FORBIDDEN"].includes(e?.message))
					await this.signIn(signMessage);
				else failure(job, e);
			}
		},
		async pass(operation) {
			if (
				!["prepare", "status"].includes(operation) ||
				!csrf ||
				state.status !== "READY" ||
				identity.network !== "devnet"
			)
				fail();
			const job = begin(),
				wallet = identity.wallet;
			const value = await post("pass", operation, {}, job.signal);
			if (
				!current(job) ||
				value.network !== "DEVNET" ||
				value.awardEligible !== false ||
				value.wallet !== wallet ||
				typeof value.mint !== "string"
			)
				fail();
			// The server awards the Pass-mint test XP when it verifies the finalized mint, so a
			// freshly minted Pass reloads XP without a manual refresh. Best effort, never fatal.
			if (value.status === "MINTED") {
				const xp = await post("calendar", "xp", { campaignId }, job.signal)
					.then(readXp)
					.catch(() => null);
				if (current(job) && xp) emit({ xp });
			}
			return value;
		},
		async referral() {
			if (!csrf || state.status !== "READY" || identity.network !== "devnet") fail();
			return readReferral(await post("calendar", "referral", { campaignId }));
		},
		/** Claim a one-time social quest (follow-x, post-x or join-discord). Returns { result: "OK" | "ALREADY", social }. */
		async socialClaim(quest) {
			if (
				!csrf ||
				state.status !== "READY" ||
				identity.network !== "devnet" ||
				!["follow-x", "post-x", "join-discord"].includes(quest)
			)
				fail();
			const value = await post("calendar", "social-claim", { campaignId, quest });
			const social = readSocial(value?.social);
			if (
				value?.testOnly !== true ||
				value.campaignId !== campaignId ||
				value.passportId !== passportId ||
				!["OK", "ALREADY"].includes(value.result) ||
				!social
			)
				fail();
			return { result: value.result, social };
		},
		/** Send a lead for a partner. XP is paid only if an admin onboards it. Returns { result: "OK" | "DUPLICATE", partnerScout }. */
		async partnerLead({ name, url, note }) {
			if (
				!csrf ||
				state.status !== "READY" ||
				identity.network !== "devnet" ||
				typeof name !== "string" ||
				name.trim().length < 2 ||
				name.trim().length > 80 ||
				typeof url !== "string" ||
				!/^https?:\/\/[^\s/?#]+/.test(url.trim()) ||
				url.trim().length > 200 ||
				typeof note !== "string" ||
				note.length > 300
			)
				fail();
			const value = await post("calendar", "partner-lead", {
				campaignId,
				name: name.trim(),
				url: url.trim(),
				note: note.trim(),
			});
			const partnerScout = readPartnerScout(value?.partnerScout);
			if (
				value?.testOnly !== true ||
				value.campaignId !== campaignId ||
				value.passportId !== passportId ||
				!["OK", "DUPLICATE"].includes(value.result) ||
				!partnerScout
			)
				fail();
			return { result: value.result, partnerScout };
		},
		async redeemReferral(code) {
			if (
				!csrf ||
				state.status !== "READY" ||
				identity.network !== "devnet" ||
				typeof code !== "string" ||
				!/^[A-Za-z0-9]{8}$/.test(code)
			)
				fail();
			const value = readReferral(
				await post("calendar", "redeem-referral", { campaignId, code }),
			);
			// Redeeming never changes the redeemer's own XP; refresh totals on the next read.
			return value;
		},
		/**
		 * Clans (devnet test). action: overview | board | create | join | leave | invite | kick. Returns
		 * { result?, overview?, board? } exactly as the backend sent it; the server enforces every rule.
		 */
		async clans(action, params = {}) {
			const bodies = {
				overview: () => ({}),
				board: () => ({
					query: typeof params.query === "string" ? params.query : "",
					limit: Number.isSafeInteger(params.limit) ? params.limit : 20,
					offset: Number.isSafeInteger(params.offset) ? params.offset : 0,
				}),
				create: () => ({ name: params.name, tag: params.tag }),
				join: () => ({ clanId: params.clanId ?? null, code: params.code ?? null }),
				leave: () => ({}),
				invite: () => ({}),
				kick: () => ({ memberRef: params.memberRef }),
				"rally-add": () => ({ gauge: params.gauge, pool: params.pool, label: params.label }),
				"rally-remove": () => ({ gauge: params.gauge }),
			};
			if (
				!csrf ||
				state.status !== "READY" ||
				identity.network !== "devnet" ||
				typeof action !== "string" ||
				!Object.hasOwn(bodies, action)
			)
				fail();
			const value = await post("calendar", "clans", { campaignId, action, ...bodies[action]() });
			if (
				value?.testOnly !== true ||
				value.campaignId !== campaignId ||
				value.passportId !== passportId ||
				value.action !== action ||
				(action === "board" ? typeof value.board !== "object" : typeof value.overview !== "object")
			)
				fail();
			return { result: value.result, overview: value.overview, board: value.board };
		},
		setIdentity(wallet, network) {
			generation++;
			controller?.abort();
			csrf = null;
			passportId = null;
			identity = { wallet, network };
			emit({
				status: !wallet
					? "DISCONNECTED"
					: network !== "devnet"
						? "WRONG_NETWORK"
						: "SIGNED_OUT",
				snapshot: null,
				history: null,
				xp: null,
				error: null,
			});
		},
		async signIn(signMessage) {
			if (
				!identity.wallet ||
				identity.network !== "devnet" ||
				typeof signMessage !== "function"
			)
				return;
			const job = begin(),
				wallet = identity.wallet;
			emit({ status: "SIGNING", snapshot: null, history: null, xp: null, error: null });
			try {
				const challenge = await post(
					"passport",
					"wallet-challenge",
					{ wallet },
					job.signal,
				);
				if (!current(job)) return;
				const expected = checkWalletChallenge(challenge, { wallet, origin });
				const signed = await signMessage(
					new TextEncoder().encode(challenge.message),
				);
				if (!current(job)) return;
				if (!(signed instanceof Uint8Array) || signed.length !== 64) fail();
				const signature = btoa(String.fromCharCode(...signed));
				const session = await post(
					"passport",
					challenge.enrollment === true ? "enroll" : "authenticate",
					{ message: challenge.message, signature },
					job.signal,
				);
				if (!current(job)) return;
				if (
					session.network !== "DEVNET" ||
					session.wallet !== wallet ||
					session.passportId !== expected ||
					!/^[A-Za-z0-9_-]{43}$/.test(session.csrfToken ?? "") ||
					!Number.isFinite(Date.parse(session.expiresAt)) ||
					Date.parse(session.expiresAt) <= Date.now()
				)
					fail();
				csrf = session.csrfToken;
				passportId = session.passportId;
				await load(job);
			} catch (e) {
				failure(job, e);
			}
		},
		async refresh() {
			if (!csrf) return;
			const job = begin();
			emit({ status: "LOADING", snapshot: null, history: null, xp: null, error: null });
			try {
				await load(job);
			} catch (e) {
				failure(job, e);
			}
		},
		async more() {
			if (!csrf || !state.history?.nextCursor || state.status !== "READY")
				return;
			const job = begin(),
				previous = state;
			emit({ status: "LOADING" });
			try {
				const history = await post(
					"calendar",
					"history",
					{ campaignId, before: previous.history.nextCursor, limit: 25 },
					job.signal,
				);
				if (!current(job)) return;
				checkPersonal(previous.snapshot, history, passportId);
				const keys = new Set(
					previous.history.receipts.map((r) => r.completionKey),
				);
				if (history.receipts.some((r) => keys.has(r.completionKey))) fail();
				emit({
					status: "READY",
					history: {
						...history,
						receipts: [...previous.history.receipts, ...history.receipts],
					},
				});
			} catch (e) {
				failure(job, e);
			}
		},
		async logout() {
			const job = begin();
			try {
				if (csrf) await post("passport", "logout", {}, job.signal);
			} catch {
				/* Clear private data even if remote logout fails. Cookie expires server-side. */
			} finally {
				if (current(job)) {
					generation++;
					csrf = null;
					passportId = null;
					emit({
						status: "SIGNED_OUT",
						snapshot: null,
						history: null,
						error: null,
					});
				}
			}
		},
		dispose() {
			generation++;
			controller?.abort();
			csrf = null;
			passportId = null;
			state = {
				status: "DISCONNECTED",
				snapshot: null,
				history: null,
				xp: null,
				error: null,
			};
		},
	};
}
