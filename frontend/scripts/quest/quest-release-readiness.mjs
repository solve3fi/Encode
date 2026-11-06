import { pathToFileURL } from "node:url";
import { devnetLpPolicy } from "./devnet-swap-progress-config.mjs";

const DEVNET_GENESIS = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
export const HARDENING_MARKERS = Object.freeze([
	"quest.abuse_hardening_revision", "quest.calendar_admin_audit", "quest_genesis.resets",
	"quest.referral_eligible_sources", "quest.lock_lp_test_source(text,text,bigint,bigint)",
    "quest.lp_inventory_cohorts", "quest.lock_lp_inventory_source(text,bigint,jsonb,bigint)",
]);

export function assessQuestReleaseReadiness(snapshot, expected) {
	const failures = [];
	const identity = snapshot.identity;
	if (!identity || identity.network !== "DEVNET" || identity.genesis_hash !== DEVNET_GENESIS ||
		identity.namespace !== "quest" || identity.environment_id !== expected.environmentId ||
		identity.manifest_sha256 !== expected.manifestSha256) failures.push("ENVIRONMENT_MISMATCH");
	if (snapshot.markers?.length !== HARDENING_MARKERS.length || snapshot.markers.some((v) => v !== true))
		failures.push("HARDENING_SCHEMA_MISSING");
	const lp = snapshot.lp;
	if (!lp?.anchorPresent) failures.push("LP_ANCHOR_MISSING");
	if (!lp?.clockPresent) failures.push("LP_CLOCK_MISSING");
	if (lp?.quarantined !== false) failures.push("LP_QUARANTINED_OR_UNKNOWN");
	if (!Number.isSafeInteger(lp?.sourceThroughSlot) || !Number.isSafeInteger(lp?.coveredThroughSlot) ||
		lp.coveredThroughSlot < lp.sourceThroughSlot || lp.invalidated !== false) failures.push("LP_COVERAGE_INCOMPLETE");
	if (!Number.isSafeInteger(lp?.rangeCount) || lp.rangeCount < 1 || (expected.pagedHistory !== true && lp.rangeCount > 64))
		failures.push("LP_HISTORY_PREFIX_LIMIT");
	if (!Number.isSafeInteger(lp?.missingPositionCount) || lp.missingPositionCount !== 0)
		failures.push("LP_INVENTORY_INCOMPLETE");
	return { ready:failures.length === 0, failures, lp:lp ?? null,
		limits:{ maximumHistoricalRanges:expected.pagedHistory === true ? null : 64, maximumRangesPerPage:expected.pagedHistory === true ? 16 : 64, maximumSlotsPerRange:256 },
		note:"Readiness checks are necessary prerequisites; a real transfer/close and LP receipt rehearsal is still required." };
}

export async function readQuestReleaseReadiness({ pool, campaignId, environment, featuredPools }) {
	if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(campaignId ?? "") || !Array.isArray(featuredPools) ||
		featuredPools.length < 1 || featuredPools.length > 50) throw new TypeError("Explicit campaign and featured pools required");
	const db = await pool.connect();
	try {
		await db.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
		await db.query("SET LOCAL statement_timeout='5000ms'");
		const identity = (await db.query("SELECT network,genesis_hash,environment_id::text,manifest_sha256,namespace FROM quest.environment_identity WHERE singleton=true")).rows;
		const markers = [];
		for (const marker of HARDENING_MARKERS) {
			const result = await db.query(marker.includes("(") ? "SELECT to_regprocedure($1) IS NOT NULL AS present" : "SELECT to_regclass($1) IS NOT NULL AS present",[marker]);
			markers.push(result.rows[0]?.present === true);
		}
		const cohortsInstalled=markers[HARDENING_MARKERS.indexOf("quest.lp_inventory_cohorts")]===true;
        const cohortUnion=cohortsInstalled ? " OR a.campaign_id IN (SELECT cohort_campaign_id FROM quest.lp_inventory_cohorts WHERE parent_campaign_id=$1)" : "";
        const result = await db.query(`SELECT
		 EXISTS(SELECT 1 FROM quest.position_baseline_anchors WHERE campaign_id=$1) AS anchor_present,
		 EXISTS(SELECT 1 FROM quest.position_timeline_clocks WHERE campaign_id=$1) AS clock_present,
		 EXISTS(SELECT 1 FROM quest.position_timeline_conflicts WHERE campaign_id=$1)
		 OR EXISTS(SELECT 1 FROM quest.position_ownership_conflicts WHERE campaign_id=$1) AS quarantined,
		 (SELECT reconciled_through_slot::text FROM genesis.indexer_cursors WHERE campaign_id=$1) AS source_slot,
		 (SELECT covered_through_slot::text FROM quest.position_timeline_coverage WHERE campaign_id=$1) AS coverage_slot,
		 COALESCE((SELECT invalidation_reason IS NOT NULL FROM quest.position_timeline_coverage WHERE campaign_id=$1),true) AS invalidated,
		 (SELECT count(*)::int FROM quest.position_timeline_ranges WHERE campaign_id=$1) AS range_count,
		 (SELECT count(DISTINCT e.position_address)::int FROM genesis.chain_events e
		 WHERE e.campaign_id=$1 AND e.pool_address=ANY($2::text[]) AND e.event_kind IN ('liquidity_increase','liquidity_decrease')
		 AND NOT EXISTS(SELECT 1 FROM quest.position_baseline_anchors a, jsonb_array_elements(a.evidence_bundle->'inventory') i
		 WHERE (a.campaign_id=$1${cohortUnion}) AND a.anchor_slot<COALESCE((SELECT reconciled_through_slot FROM genesis.indexer_cursors WHERE campaign_id=$1),0) AND i->>'positionAddress'=e.position_address)) AS missing_positions`,[campaignId,featuredPools]);
		const row = result.rows[0];
        if(cohortsInstalled) {
            const children=await db.query(`SELECT EXISTS(SELECT 1 FROM quest.lp_inventory_cohorts c
                JOIN quest.position_baseline_anchors a ON a.campaign_id=c.cohort_campaign_id
                LEFT JOIN quest.position_timeline_coverage v ON v.campaign_id=c.cohort_campaign_id
                WHERE c.parent_campaign_id=$1 AND a.anchor_slot<COALESCE($2::bigint,0) AND
                (v.covered_through_slot IS NULL OR v.covered_through_slot<$2::bigint OR v.invalidation_reason IS NOT NULL OR
                EXISTS(SELECT 1 FROM quest.position_timeline_conflicts WHERE campaign_id=c.cohort_campaign_id) OR
                EXISTS(SELECT 1 FROM quest.position_ownership_conflicts WHERE campaign_id=c.cohort_campaign_id))) AS incomplete`,[campaignId,row.source_slot]);
            row.invalidated=row.invalidated||children.rows[0]?.incomplete!==false;
        }
		const integer = (value) => value !== null && /^(0|[1-9][0-9]*)$/.test(String(value)) && Number.isSafeInteger(Number(value)) ? Number(value) : null;
		const report = assessQuestReleaseReadiness({identity:identity.length === 1 ? identity[0] : null,markers,lp:{
			anchorPresent:row.anchor_present,clockPresent:row.clock_present,quarantined:row.quarantined,
			sourceThroughSlot:integer(row.source_slot),coveredThroughSlot:integer(row.coverage_slot),invalidated:row.invalidated,
			rangeCount:row.range_count,missingPositionCount:row.missing_positions,
		}},environment);
		await db.query("COMMIT");
		return report;
	} catch (error) {
		await db.query("ROLLBACK").catch(() => {});
		throw error;
	} finally {db.release();}
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	const {default:pg} = await import("pg");
	const need = (name) => {if (!process.env[name]) throw new Error(`Missing ${name}`);return process.env[name];};
	const pool = new pg.Pool({connectionString:need("QUEST_RELEASE_READ_DB_URL"),max:1,connectionTimeoutMillis:5000});
	try {
		const report = await readQuestReleaseReadiness({pool,campaignId:need("QUEST_SWAP_CAMPAIGN_ID"),
			environment:{environmentId:need("QUEST_ENVIRONMENT_ID"),manifestSha256:need("QUEST_MANIFEST_SHA256"),pagedHistory:process.env.QUEST_LP_PAGED_HISTORY === "1"},
			featuredPools:devnetLpPolicy().featuredPools});
		console.log(JSON.stringify(report,null,2));
		if (!report.ready) process.exitCode=2;
	} finally {await pool.end();}
}
