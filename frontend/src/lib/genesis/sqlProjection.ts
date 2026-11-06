import {
	projectQuestProgress,
	type TrustedQuestMetrics,
	validateQuestRuleRevision,
} from "./questProjection.ts";
import type { SqlPool } from "./sqlLedger";

export const GENESIS_PROJECTION_VERSION = "quest-projection-v1";

type RuleRow = { rules: unknown };
type CursorRow = { next_slot: string; reconciled_through_slot: string | null };
type WalletRow = {
	rule_revision: number;
	projection_version: string;
	computed_through_slot: string;
	qualifying_swaps: number;
	active_trading_days: number;
	lp_usd_cent_seconds: string;
	provisional_xp: string;
};
type DefinitionRow = { slug: string; category: string; verification: string };
type QuestRow = {
	quest_slug: string;
	verification: string;
	progress_value: string;
	status: string;
	provisional_xp: string;
};

const MAX_BIGINT = BigInt("9223372036854775807");
const MAX_NUMERIC_38 = BigInt("99999999999999999999999999999999999999");

function dbInteger(value: string | number, label: string): bigint {
	if (
		(typeof value !== "string" &&
			(typeof value !== "number" || !Number.isSafeInteger(value))) ||
		!/^\d+$/.test(String(value))
	)
		throw new Error(`Invalid stored Genesis ${label}.`);
	return BigInt(value);
}

/** Persist a projection only after indexing and reconciliation have covered its slot. */
export async function persistGenesisQuestProjection(input: {
	pool: SqlPool;
	campaignId: string;
	wallet: string;
	ruleRevision: number;
	computedThroughSlot: number;
	programId: string;
	decoderVersion: string;
	metrics: TrustedQuestMetrics;
}): Promise<{ written: boolean; provisionalXp: bigint }> {
	const {
		pool,
		campaignId,
		wallet,
		ruleRevision,
		computedThroughSlot,
		programId,
		decoderVersion,
		metrics,
	} = input;
	if (
		!campaignId ||
		!wallet ||
		!programId ||
		!decoderVersion ||
		!Number.isSafeInteger(ruleRevision) ||
		ruleRevision < 1 ||
		ruleRevision > 2_147_483_647 ||
		!Number.isSafeInteger(computedThroughSlot) ||
		computedThroughSlot < 0
	)
		throw new TypeError("Invalid Genesis projection identity or watermark.");
	const client = await pool.connect();
	let inTransaction = false;
	try {
		await client.query("BEGIN");
		inTransaction = true;
		const published = await client.query<RuleRow>(
			`SELECT rules FROM genesis.rule_revisions
			 WHERE campaign_id = $1 AND revision = $2
			   AND effective_from <= now() FOR SHARE`,
			[campaignId, ruleRevision],
		);
		if (published.rows.length !== 1)
			throw new Error("Genesis rule revision is not published.");
		const rules = validateQuestRuleRevision(published.rows[0].rules);
		if (rules.campaignId !== campaignId || rules.revision !== ruleRevision)
			throw new Error("Stored Genesis rule revision does not match its key.");
		const cursor = await client.query<CursorRow>(
			`SELECT next_slot::text, reconciled_through_slot::text
             FROM genesis.indexer_cursors
             WHERE campaign_id = $1 AND program_id = $2 AND decoder_version = $3
             FOR SHARE`,
			[campaignId, programId, decoderVersion],
		);
		if (cursor.rows.length !== 1)
			throw new Error("Genesis finalized indexer cursor is missing.");
		const watermark = BigInt(computedThroughSlot);
		if (
			cursor.rows[0].reconciled_through_slot === null ||
			dbInteger(cursor.rows[0].next_slot, "next slot") <= watermark ||
			dbInteger(cursor.rows[0].reconciled_through_slot, "reconciliation slot") <
				watermark
		)
			throw new Error(
				"Genesis source range is not reconciled through the projection slot.",
			);
		const projection = projectQuestProgress({
			campaignId,
			rules,
			wallet,
			computedThroughSlot,
			metrics,
		});
		if (projection.lpUsdCentSeconds > MAX_NUMERIC_38)
			throw new RangeError("Genesis LP integral exceeds the database range.");
		if (
			projection.qualifyingSwaps > 2_147_483_647 ||
			projection.activeTradingDays > 2_147_483_647
		)
			throw new RangeError(
				"Genesis activity count exceeds the database range.",
			);

		// The parent row serializes concurrent writers and blocks child inserts for this wallet.
		const created = await client.query(
			`INSERT INTO genesis.wallet_progress
             (campaign_id, wallet, rule_revision, projection_version, computed_through_slot)
             VALUES ($1, $2, $3, $4, 0)
             ON CONFLICT (campaign_id, wallet) DO NOTHING`,
			[campaignId, wallet, ruleRevision, GENESIS_PROJECTION_VERSION],
		);
		const existing = await client.query<WalletRow>(
			`SELECT rule_revision, projection_version, computed_through_slot::text,
                    qualifying_swaps, active_trading_days, lp_usd_cent_seconds::text,
                    provisional_xp::text
             FROM genesis.wallet_progress
             WHERE campaign_id = $1 AND wallet = $2 FOR UPDATE`,
			[campaignId, wallet],
		);
		if (existing.rows.length !== 1)
			throw new Error("Genesis wallet progress lock failed.");
		const previous = existing.rows[0];
		const previousSlot = dbInteger(
			previous.computed_through_slot,
			"projection slot",
		);
		if (
			previous.rule_revision > ruleRevision ||
			previousSlot > watermark ||
			(previous.rule_revision === ruleRevision &&
				previous.projection_version !== GENESIS_PROJECTION_VERSION &&
				created.rowCount !== 1)
		)
			throw new Error(
				"A newer or incompatible Genesis projection already exists.",
			);

		const definitions = await client.query<DefinitionRow>(
			`SELECT slug, category, verification FROM genesis.quest_definitions
             WHERE campaign_id = $1 FOR SHARE`,
			[campaignId],
		);
		const definitionBySlug = new Map(
			definitions.rows.map((row) => [row.slug, row]),
		);
		for (const rule of rules.quests) {
			const definition = definitionBySlug.get(rule.slug);
			if (
				!definition ||
				definition.category !== rule.category ||
				definition.verification !== rule.verification
			)
				throw new Error(
					`Genesis quest definition disagrees with rule: ${rule.slug}`,
				);
		}
		const rows = await client.query<QuestRow>(
			`SELECT qp.quest_slug, qd.verification, qp.progress_value::text,
                    qp.status, qp.provisional_xp::text
             FROM genesis.quest_progress qp
             JOIN genesis.quest_definitions qd
               ON qd.campaign_id = qp.campaign_id AND qd.slug = qp.quest_slug
             WHERE qp.campaign_id = $1 AND qp.wallet = $2 FOR UPDATE OF qp`,
			[campaignId, wallet],
		);
		let manualXp = BigInt(0);
		for (const row of rows.rows) {
			const xp = dbInteger(row.provisional_xp, "quest XP");
			if (row.verification === "manual") {
				if (!["provisional", "approved"].includes(row.status) && xp > BigInt(0))
					throw new Error("Unapproved manual Genesis quest carries XP.");
				manualXp += xp;
			} else if (["approved", "rejected"].includes(row.status)) {
				throw new Error(
					"Reviewed Genesis quest requires manual reconciliation.",
				);
			}
		}
		const totalXp = manualXp + projection.provisionalXp;
		if (totalXp > MAX_BIGINT)
			throw new RangeError("Genesis wallet XP exceeds the database range.");
		const autoRows = rows.rows.filter((row) => row.verification !== "manual");
		const sameQuestRows =
			autoRows.length === projection.quests.length &&
			projection.quests.every((quest) => {
				const row = autoRows.find((item) => item.quest_slug === quest.slug);
				return (
					row &&
					dbInteger(row.progress_value, "quest progress") ===
						quest.progressValue &&
					row.status === quest.status &&
					dbInteger(row.provisional_xp, "quest XP") === quest.provisionalXp
				);
			});
		if (
			created.rowCount !== 1 &&
			previous.rule_revision === ruleRevision &&
			previousSlot === watermark
		) {
			if (
				previous.qualifying_swaps !== projection.qualifyingSwaps ||
				previous.active_trading_days !== projection.activeTradingDays ||
				dbInteger(previous.lp_usd_cent_seconds, "LP integral") !==
					projection.lpUsdCentSeconds ||
				dbInteger(previous.provisional_xp, "wallet XP") !== totalXp ||
				!sameQuestRows
			)
				throw new Error(
					"Conflicting Genesis projection at the same watermark.",
				);
			await client.query("COMMIT");
			inTransaction = false;
			return { written: false, provisionalXp: totalXp };
		}
		const update = await client.query(
			`UPDATE genesis.wallet_progress
             SET rule_revision = $3, projection_version = $4, computed_through_slot = $5,
                 qualifying_swaps = $6, active_trading_days = $7,
                 lp_usd_cent_seconds = $8, provisional_xp = $9, computed_at = now()
             WHERE campaign_id = $1 AND wallet = $2`,
			[
				campaignId,
				wallet,
				ruleRevision,
				GENESIS_PROJECTION_VERSION,
				computedThroughSlot,
				projection.qualifyingSwaps,
				projection.activeTradingDays,
				projection.lpUsdCentSeconds.toString(),
				totalXp.toString(),
			],
		);
		if (update.rowCount !== 1)
			throw new Error("Genesis wallet progress update failed.");
		await client.query(
			`DELETE FROM genesis.quest_progress qp
             USING genesis.quest_definitions qd
             WHERE qp.campaign_id = $1 AND qp.wallet = $2
               AND qd.campaign_id = qp.campaign_id AND qd.slug = qp.quest_slug
               AND qd.verification <> 'manual'
               AND NOT (qp.quest_slug = ANY($3::text[]))`,
			[campaignId, wallet, projection.quests.map((quest) => quest.slug)],
		);
		for (const quest of projection.quests) {
			const upsert = await client.query(
				`INSERT INTO genesis.quest_progress
                 (campaign_id, wallet, quest_slug, progress_value, status, provisional_xp)
                 VALUES ($1, $2, $3, $4, $5, $6)
                 ON CONFLICT (campaign_id, wallet, quest_slug) DO UPDATE SET
                   progress_value = EXCLUDED.progress_value,
                   status = EXCLUDED.status,
                   provisional_xp = EXCLUDED.provisional_xp,
                   computed_at = now()
                 WHERE genesis.quest_progress.status NOT IN ('approved', 'rejected')`,
				[
					campaignId,
					wallet,
					quest.slug,
					quest.progressValue.toString(),
					quest.status,
					quest.provisionalXp.toString(),
				],
			);
			if (upsert.rowCount !== 1)
				throw new Error(
					"Genesis quest progress was reviewed during projection.",
				);
		}
		const sum = await client.query<{ total: string }>(
			`SELECT COALESCE(SUM(provisional_xp), 0)::text AS total
             FROM genesis.quest_progress WHERE campaign_id = $1 AND wallet = $2`,
			[campaignId, wallet],
		);
		if (
			sum.rows.length !== 1 ||
			dbInteger(sum.rows[0].total, "XP sum") !== totalXp
		)
			throw new Error("Genesis wallet and quest XP do not reconcile.");
		await client.query("COMMIT");
		inTransaction = false;
		return { written: true, provisionalXp: totalXp };
	} catch (error) {
		if (inTransaction) await client.query("ROLLBACK");
		throw error;
	} finally {
		client.release();
	}
}
