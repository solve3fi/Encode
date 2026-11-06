import assert from "node:assert/strict";
import { test } from "node:test";
import { assertPassportId } from "./passport-id.mjs";

test("Passport IDs match the Devnet database UUID shape", () => {
	const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
	assert.equal(assertPassportId(id), id);
	for (const value of [
		"psp_01HF0000000000000000000000",
		id.toUpperCase(),
		"",
		null,
	]) {
		assert.throws(() => assertPassportId(value), /canonical lowercase UUID/);
	}
});
