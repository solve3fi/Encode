import assert from "node:assert/strict";
import {test} from "node:test";
import {liquidityRangeFixture,timelineExtension} from "../../tests/fixtures/quest-position-timeline.mjs";
import {decodePositionLiquidityBlockRange} from "./position-liquidity-replay.mjs";
import {createPositionTimelinePager,projectPositionTimelineIntervals} from "./position-timeline-projector.mjs";
import {timelineClock} from "./position-timeline-integrity.mjs";

export async function pagingFixture(count=65) {
	let f=liquidityRangeFixture();const anchor=f.anchor;
	const ranges=[await decodePositionLiquidityBlockRange(f)];
	for(let i=1;i<count;i++) {
		f=timelineExtension(f,{slot:f.endSlot+1,time:1000+i,signature:`page-liquidity-${i}`});
		f.endSlot+=255;
		ranges.push(await decodePositionLiquidityBlockRange(f));
	}
	const clock=timelineClock(anchor,{blockhash:"11111111111111111111111111111112",blockTime:900});
	return {anchor,ranges,clock};
}
const verifier=(ranges)=>()=>{
	const signatures=ranges.flatMap(r=>r.ownershipRange.blocks.flatMap(b=>b.transactions.map(t=>t.signature)));
	assert.equal(new Set(signatures).size,signatures.length,"duplicate prefix signature");
};
test("65 ranges carry liquidity beyond the original 64-range bound with bounded pages",async()=>{
	const f=await pagingFixture();
	assert.throws(()=>projectPositionTimelineIntervals({...f,endSlot:f.ranges.at(-1).endSlot}),/bounded complete prefix/);
	const pager=createPositionTimelinePager({...f,assertGlobalIdentities:verifier(f.ranges)});
	let result;
	for(let i=0;i<f.ranges.length;i+=16) {
		const ranges=f.ranges.slice(i,i+16);
		result=await pager.append({ranges,endSlot:ranges.at(-1).endSlot});
	}
	assert.equal(result.positions[0].endSlotLiquidityRaw,String(107+64*7));
	assert.equal(result.endSlot,f.ranges.at(-1).endSlot);
	assert.ok(result.endSlot-f.anchor.firstReplaySlot+1>16384);
	assert.equal(result.historySemantics,"VERIFIED_PAGED_PREFIX");
});
test("paged projection equals the original verifier across a supported prefix",async()=>{
	const f=await pagingFixture(20),expected=projectPositionTimelineIntervals({...f,endSlot:f.ranges.at(-1).endSlot});
	const pager=createPositionTimelinePager({...f,assertGlobalIdentities:verifier(f.ranges)});
	const a=await pager.append({ranges:f.ranges.slice(0,10),endSlot:f.ranges[9].endSlot});
	const b=await pager.append({ranges:f.ranges.slice(10),endSlot:f.ranges.at(-1).endSlot});
	assert.equal(b.positions[0].endSlotLiquidityRaw,expected.positions[0].endSlotLiquidityRaw);
	const flatten=out=>out.intervalPositions[0].intervals.map(({sourceKey,...interval})=>interval);
	assert.deepEqual([...flatten(a),...flatten(b)],flatten(expected));
});
test("returned projections cannot corrupt the opaque continuation",async()=>{
	const f=await pagingFixture(2),pager=createPositionTimelinePager({...f,assertGlobalIdentities:verifier(f.ranges)});
	const a=await pager.append({ranges:[f.ranges[0]],endSlot:f.ranges[0].endSlot});
	a.positions[0].endSlotLiquidityRaw="999999";
	const b=await pager.append({ranges:[f.ranges[1]],endSlot:f.ranges[1].endSlot});
	assert.equal(b.positions[0].endSlotLiquidityRaw,"114");
});
test("cross-page chain gaps and rejected global identities do not advance continuation",async()=>{
	const f=await pagingFixture(3),pager=createPositionTimelinePager({...f,assertGlobalIdentities:verifier(f.ranges)});
	await pager.append({ranges:[f.ranges[0]],endSlot:f.ranges[0].endSlot});
	await assert.rejects(pager.append({ranges:[f.ranges[2]],endSlot:f.ranges[2].endSlot}),/continuity/);
	assert.equal((await pager.append({ranges:[f.ranges[1]],endSlot:f.ranges[1].endSlot})).positions[0].endSlotLiquidityRaw,"114");
	const refused=createPositionTimelinePager({...f,assertGlobalIdentities:()=>{throw new Error("duplicate identity");}});
	await assert.rejects(refused.append({ranges:[f.ranges[0]],endSlot:f.ranges[0].endSlot}),/duplicate identity/);
});

test("transferred ownership survives the next page",async()=>{
 const {transferEvidenceFixture}=await import("../../tests/fixtures/quest-position-ownership.mjs");
 const raw=liquidityRangeFixture({ownerWallet:"11111111111111111111111111111113",tokenAccountAddress:"11111111111111111111111111111114"});
 raw.blocks[0].block.transactions.unshift(transferEvidenceFixture().transactions[0]);
 const next=timelineExtension(raw);next.blocks[0].block.transactions=[];
 const ranges=[await decodePositionLiquidityBlockRange(raw),await decodePositionLiquidityBlockRange(next)];
 const clock=timelineClock(raw.anchor,{blockhash:"11111111111111111111111111111112",blockTime:900});
 const pager=createPositionTimelinePager({anchor:raw.anchor,clock,assertGlobalIdentities:verifier(ranges)});
 await pager.append({ranges:[ranges[0]],endSlot:ranges[0].endSlot});
 const result=await pager.append({ranges:[ranges[1]],endSlot:ranges[1].endSlot});
 assert.equal(result.positions[0].ownerWallet,"11111111111111111111111111111113");
 assert.equal(result.intervalPositions[0].intervals[0].wallet,"11111111111111111111111111111113");
});
