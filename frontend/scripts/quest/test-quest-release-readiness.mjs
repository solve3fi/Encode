import assert from "node:assert/strict";
import {test} from "node:test";
import {assessQuestReleaseReadiness,HARDENING_MARKERS} from "./quest-release-readiness.mjs";

const expected={environmentId:"11111111-1111-4111-8111-111111111111",manifestSha256:"a".repeat(64)};
const snapshot=()=>({identity:{network:"DEVNET",genesis_hash:"EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG",namespace:"quest",
	environment_id:expected.environmentId,manifest_sha256:expected.manifestSha256},markers:HARDENING_MARKERS.map(()=>true),
	lp:{anchorPresent:true,clockPresent:true,quarantined:false,sourceThroughSlot:100,coveredThroughSlot:100,invalidated:false,rangeCount:4,missingPositionCount:0}});
test("complete matching prerequisites permit release review without asserting end-to-end proof",()=>{
	const result=assessQuestReleaseReadiness(snapshot(),expected);
	assert.equal(result.ready,true);assert.match(result.note,/rehearsal is still required/);
});
test("explicitly enabled paged history accepts more than 64 ranges while retaining page limits",()=>{
	const s=snapshot();s.lp.rangeCount=65;
	const result=assessQuestReleaseReadiness(s,{...expected,pagedHistory:true});
	assert.equal(result.ready,true);assert.equal(result.limits.maximumRangesPerPage,16);
	assert.equal(result.limits.maximumHistoricalRanges,null);
});
for (const [reason,alter] of [
	["ENVIRONMENT_MISMATCH",s=>s.identity.environment_id="different"],
	["HARDENING_SCHEMA_MISSING",s=>s.markers[4]=false],
	["LP_ANCHOR_MISSING",s=>s.lp.anchorPresent=false],
	["LP_CLOCK_MISSING",s=>s.lp.clockPresent=false],
	["LP_QUARANTINED_OR_UNKNOWN",s=>s.lp.quarantined=true],
	["LP_COVERAGE_INCOMPLETE",s=>s.lp.coveredThroughSlot=99],
	["LP_COVERAGE_INCOMPLETE",s=>s.lp.invalidated=true],
	["LP_HISTORY_PREFIX_LIMIT",s=>s.lp.rangeCount=65],
	["LP_INVENTORY_INCOMPLETE",s=>s.lp.missingPositionCount=1],
]) test(`release check refuses ${reason}`,()=>{const s=snapshot();alter(s);const r=assessQuestReleaseReadiness(s,expected);assert.equal(r.ready,false);assert.ok(r.failures.includes(reason));});
