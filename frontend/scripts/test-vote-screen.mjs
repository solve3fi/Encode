import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";
import BN from "bn.js";
import { gaugeVotingPower, votingPowerUnits, votingShare } from "../src/lib/voteDisplay.ts";
const require = createRequire(import.meta.url);
function load(relative, overrides = {}) {
	const source = readFileSync(new URL(relative, import.meta.url), "utf8");
	const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true, target: ts.ScriptTarget.ES2022 } }).outputText;
	const exports = {};
	new Function("require", "exports", js)((name) => name in overrides ? overrides[name] : require(name), exports);
	return exports;
}
const pool = (address, votePercent) => ({ getAddress: () => address, votePercent });
test("shared state clamps total, frees remainder on edit/remove/reset and never mutates pool records", () => {
	const { createVoteStore } = load("../src/stores/vote/index.ts");
	const store = createVoteStore(); const actions = store.getState().actions;
	const a = pool("a", 70); actions.setVoteState(a); actions.setVoteState(pool("b", 100));
	assert.deepEqual(store.getState().voteState.map((v) => v.votePercent), [70, 30]);
	assert.equal(a.votePercent, 70);
	actions.setVoteState(pool("c", 20)); assert.equal(store.getState().voteState.length, 2);
	actions.setVoteState(pool("a", 40)); actions.setVoteState(pool("c", 100));
	assert.deepEqual(store.getState().voteState.map((v) => v.votePercent), [40, 30, 30]);
	actions.setVoteState(pool("b", 0)); actions.setVoteState(pool("c", 100));
	assert.deepEqual(store.getState().voteState.map((v) => v.votePercent), [40, 60]);
	actions.removeVoteState("a"); actions.setVoteState(pool("c", 100));
	assert.equal(store.getState().voteState[0].votePercent, 100);
	actions.resetVoteState(); assert.equal(store.getState().voteState.length, 0);
});
test("gauge address mapping returns voting weight while pool address does not", () => {
	const snapshot = { votePools: ["gauge-a", "gauge-b"], votePowers: [new BN("3000000000000"), new BN("1000000000000")] };
	assert.equal(gaugeVotingPower(snapshot, "gauge-a").toString(), "3000000000000");
	assert.equal(gaugeVotingPower(snapshot, "pool-a").toString(), "0");
});
test("large voting balances above Number.MAX_SAFE_INTEGER do not throw or round percentages to zero", () => {
	const power = new BN("50000000000000000");
	assert.equal(votingPowerUnits(power), 50000000);
	assert.equal(votingShare(power, new BN("100000000000000000")), 50);
});
test("gauge hook isolates current-epoch fees from other gauges and epochs", async () => {
	const key = (id) => ({ toString: () => id, equals: (other) => other.toString() === id });
	const a = key("gauge-a"); const b = key("gauge-b");
	const { useVotes } = load("../src/stores/vote/hooks/useVotes.ts", {
		"@tanstack/react-query": { useQuery: (options) => options },
		"@solana/wallet-adapter-react": { useConnection: () => ({ connection: {} }) },
		"@/configs/lock": { SUPPORT_MINT_TOKENS: {} },
		"@/hooks/useVesolveProgram": { useVesolveProgram: () => ({}), getEpochPDA: () => ["epoch"], vesolveAccount: {
			gauge: () => ({ all: async () => [{ publicKey: a, account: { poolAddress: key("pool-a"), isActive: true } }, { publicKey: b, account: { poolAddress: key("pool-b"), isActive: false } }] }),
			epoch: () => ({ fetchNullable: async () => ({ bribes: [] }) }),
			vault: () => ({ all: async () => [
				{ account: { gauge: a, epoch: new BN(2), poolRewardsA: new BN(999), poolRewardsB: new BN(999) } },
				{ account: { gauge: b, epoch: new BN(3), poolRewardsA: new BN(555), poolRewardsB: new BN(555) } },
				{ account: { gauge: a, epoch: new BN(3), poolRewardsA: new BN(123), poolRewardsB: new BN(456) } },
			] }),
		} },
	});
	const results = await useVotes("devnet", 3).queryFn();
	assert.equal(results.length, 1);
	assert.equal(results[0].tradingFeesA.toString(), "123");
	assert.equal(results[0].tradingFeesB.toString(), "456");
});
test("epoch hook uses voting power, not number of ballots, as percentage denominator", async () => {
	const data = { totalVotes: new BN(2), totalVotingPower: new BN("4000000000000"), gaugeWeights: [{ gauge: "gauge-a", weight: new BN("3000000000000") }] };
	const { useVote } = load("../src/stores/vote/hooks/useVote.ts", {
		"@tanstack/react-query": { useQuery: (options) => options },
		"@/hooks/useVesolveProgram": { useVesolveProgram: () => ({}), getEpochPDA: () => ["epoch"], vesolveAccount: { epoch: () => ({ fetchNullable: async () => data }) } },
	});
	const result = await useVote("devnet", 3).queryFn();
	assert.equal(result.votes.toString(), "4000000000000");
	assert.equal(result.votePowers[0].muln(100).div(result.votes).toNumber(), 75);
});
