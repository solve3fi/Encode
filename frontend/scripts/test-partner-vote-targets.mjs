import assert from "node:assert/strict";
import { test } from "node:test";
import { partnerVoteTargets } from "./lib/partner-vote-targets.mjs";

const space = (extra = {}) => ({ status: "active", poolAddress: "POOL1", wallets: ["W1", "W2"], ...extra });
const on = { vote: true, autolock: false, updatedAt: 1 };

test("a wallet on an active space with a pool and a saved ON preference is targeted", () => {
	const { targets, conflicts } = partnerVoteTargets({ spaces: { a: space() }, defaults: { W1: on } });
	assert.deepEqual([...targets], [["W1", "POOL1"]]);
	assert.deepEqual(conflicts, []);
});

test("only wallets that saved ON are targeted; unsaved or OFF never count", () => {
	const { targets } = partnerVoteTargets({
		spaces: { a: space({ wallets: ["W1", "W2", "W3"] }) },
		defaults: { W1: on, W2: { vote: false }, /* W3 never saved */ },
	});
	assert.deepEqual([...targets.keys()], ["W1"]);
});

test("revoked spaces and spaces without a pool target nobody", () => {
	assert.equal(partnerVoteTargets({ spaces: { a: space({ status: "revoked" }) }, defaults: { W1: on } }).targets.size, 0);
	assert.equal(partnerVoteTargets({ spaces: { a: space({ poolAddress: undefined }) }, defaults: { W1: on } }).targets.size, 0);
	assert.equal(partnerVoteTargets({ spaces: { a: space({ poolAddress: "" }) }, defaults: { W1: on } }).targets.size, 0);
});

test("a wallet on two active spaces with different pools is ambiguous and skipped", () => {
	const { targets, conflicts } = partnerVoteTargets({
		spaces: { a: space(), b: space({ poolAddress: "POOL2", wallets: ["W1"] }) },
		defaults: { W1: on, W2: on },
	});
	assert.deepEqual([...targets], [["W2", "POOL1"]]);
	assert.deepEqual(conflicts, ["W1"]);
});

test("the same pool on two spaces is not a conflict", () => {
	const { targets, conflicts } = partnerVoteTargets({
		spaces: { a: space(), b: space({ wallets: ["W1"] }) },
		defaults: { W1: on },
	});
	assert.deepEqual([...targets], [["W1", "POOL1"]]);
	assert.deepEqual(conflicts, []);
});

test("missing stores are treated as empty", () => {
	assert.equal(partnerVoteTargets({ spaces: undefined, defaults: undefined }).targets.size, 0);
	assert.equal(partnerVoteTargets({ spaces: {}, defaults: {} }).targets.size, 0);
});
