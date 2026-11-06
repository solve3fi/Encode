// Pure replay of server-owned Quest ledger rows. No XP rate or Level threshold
// is chosen here; this is a reconciliation input, not a browser award path.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const INTEGER = /^(0|-?[1-9][0-9]*)$/;
const HEX_256 = /^[0-9a-f]{64}$/;
const SEASON_KEY = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const MAX_BIGINT = 9223372036854775807n;
const MIN_BIGINT = -9223372036854775808n;

function integer(value, label) {
	if (typeof value !== "string" || !INTEGER.test(value)) {
		throw new TypeError(`Quest ${label} must be a canonical integer string`);
	}
	const parsed = BigInt(value);
	if (parsed < MIN_BIGINT || parsed > MAX_BIGINT) {
		throw new RangeError(`Quest ${label} exceeds PostgreSQL bigint range`);
	}
	return parsed;
}

function requiredText(value, label) {
	if (typeof value !== "string" || value.trim() !== value || !value) {
		throw new TypeError(`Quest ${label} is required`);
	}
	return value;
}

function ensurePassport(row, passports, network) {
	if (row.network !== network || !passports.has(row.passport_id)) {
		throw new Error("Quest ledger row has wrong network or unknown Passport");
	}
	return passports.get(row.passport_id);
}

function ensureOrder(row, priorId, label) {
	const eventId = integer(row.event_id, `${label} event ID`);
	if (eventId <= priorId) {
		throw new Error(`Quest ${label} events must be in append order`);
	}
	return eventId;
}

/**
 * Rebuild all Passport totals from ordered PostgreSQL rows. The caller must
 * read complete Devnet ledger tables under a stable snapshot; filtering by
 * Passport before this replay would hide cross-Passport source reuse.
 */
export function rebuildPassportProgress({
	network,
	passportIds,
	xpEvents,
	levelEvents,
}) {
	if (
		network !== "DEVNET" ||
		!Array.isArray(passportIds) ||
		!Array.isArray(xpEvents) ||
		!Array.isArray(levelEvents)
	) {
		throw new TypeError("Quest replay requires complete Devnet ledger arrays");
	}
	const passports = new Map();
	for (const passportId of passportIds) {
		if (
			typeof passportId !== "string" ||
			!UUID.test(passportId) ||
			passports.has(passportId)
		) {
			throw new TypeError(
				"Quest replay requires unique canonical Passport IDs",
			);
		}
		passports.set(passportId, {
			passportId,
			lifetimeXp: 0n,
			seasonXp: new Map(),
			governanceBonusLevels: 0n,
		});
	}

	const xpById = new Map();
	const xpIdempotency = new Set();
	const sourceAwards = new Set();
	const xpReversals = new Set();
	let lastXpId = 0n;
	for (const row of xpEvents) {
		const progress = ensurePassport(row, passports, network);
		const eventId = ensureOrder(row, lastXpId, "XP");
		lastXpId = eventId;
		const key = requiredText(row.idempotency_key, "XP idempotency key");
		if (xpIdempotency.has(key))
			throw new Error("Quest XP idempotency key reused");
		xpIdempotency.add(key);
		const delta = integer(row.xp_delta, "XP delta");
		if (row.kind === "AWARD") {
			if (
				delta <= 0n ||
				!Number.isSafeInteger(row.rule_revision) ||
				row.rule_revision <= 0 ||
				!HEX_256.test(row.evidence_sha256)
			) {
				throw new Error(
					"Quest XP award requires positive delta, rule revision, and evidence hash",
				);
			}
			const source = requiredText(row.source_event_key, "source event key");
			const qualification = requiredText(
				row.qualification_key,
				"qualification key",
			);
			const awardKey = JSON.stringify([network, source, qualification]);
			if (sourceAwards.has(awardKey)) {
				throw new Error("Quest source qualification awarded twice");
			}
			sourceAwards.add(awardKey);
			if (row.reverses_event_id !== null) {
				throw new Error("Quest XP award cannot reverse another event");
			}
		} else if (row.kind === "REVERSAL") {
			const targetId = integer(row.reverses_event_id, "XP reversal target");
			const target = xpById.get(targetId);
			if (
				target?.kind !== "AWARD" ||
				target.passport_id !== row.passport_id ||
				xpReversals.has(targetId) ||
				delta !== -target.delta ||
				row.season_key !== target.season_key
			) {
				throw new Error("Quest XP reversal does not match one prior award");
			}
			requiredText(row.review_ref, "XP reversal review reference");
			xpReversals.add(targetId);
		} else {
			throw new Error("Quest XP event kind is unknown");
		}
		progress.lifetimeXp += delta;
		if (progress.lifetimeXp < 0n || progress.lifetimeXp > MAX_BIGINT) {
			throw new RangeError("Quest lifetime XP is outside supported range");
		}
		if (row.season_key !== null) {
			const season = requiredText(row.season_key, "season key");
			if (!SEASON_KEY.test(season))
				throw new TypeError("Quest season key is invalid");
			const total = (progress.seasonXp.get(season) ?? 0n) + delta;
			if (total < 0n || total > MAX_BIGINT) {
				throw new RangeError("Quest season XP is outside supported range");
			}
			progress.seasonXp.set(season, total);
		}
		xpById.set(eventId, { ...row, delta });
	}

	const levelById = new Map();
	const levelIdempotency = new Set();
	const governanceEpochs = new Set();
	const levelReversals = new Set();
	let lastLevelId = 0n;
	for (const row of levelEvents) {
		const progress = ensurePassport(row, passports, network);
		const eventId = ensureOrder(row, lastLevelId, "Level");
		lastLevelId = eventId;
		const key = requiredText(row.idempotency_key, "Level idempotency key");
		if (levelIdempotency.has(key))
			throw new Error("Quest Level idempotency key reused");
		levelIdempotency.add(key);
		const delta = integer(row.level_delta, "Level delta");
		if (row.kind === "GOVERNANCE_EPOCH") {
			const epoch = integer(row.epoch_id, "governance epoch");
			const epochKey = JSON.stringify([row.passport_id, epoch.toString()]);
			if (
				epoch < 0n ||
				delta !== 1n ||
				governanceEpochs.has(epochKey) ||
				!Number.isSafeInteger(row.rule_revision) ||
				row.rule_revision <= 0 ||
				!HEX_256.test(row.evidence_sha256)
			) {
				throw new Error(
					"Quest governance requires evidence and at most one Level per Passport epoch",
				);
			}
			governanceEpochs.add(epochKey);
			if (row.reverses_event_id !== null) {
				throw new Error("Quest governance Level cannot reverse another event");
			}
		} else if (row.kind === "REVERSAL") {
			const targetId = integer(row.reverses_event_id, "Level reversal target");
			const target = levelById.get(targetId);
			if (
				target?.kind !== "GOVERNANCE_EPOCH" ||
				target.passport_id !== row.passport_id ||
				levelReversals.has(targetId) ||
				delta !== -1n
			) {
				throw new Error("Quest Level reversal does not match one prior grant");
			}
			requiredText(row.review_ref, "Level reversal review reference");
			levelReversals.add(targetId);
		} else {
			throw new Error("Quest Level event kind is unknown");
		}
		progress.governanceBonusLevels += delta;
		if (progress.governanceBonusLevels < 0n) {
			throw new RangeError("Quest governance Level total cannot be negative");
		}
		levelById.set(eventId, { ...row, delta });
	}

	return {
		network,
		throughXpEventId: lastXpId,
		throughLevelEventId: lastLevelId,
		passports,
	};
}
