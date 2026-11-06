import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import * as XLSX from "xlsx";
import { AIRDROP_PARTNERS, PARTNER_BUDGETS, parseAirdropSnapshot, parseAirdropUpload, reconcileAirdropSnapshot } from "../src/lib/airdropSnapshot.ts";

const owner = "0x0000000000000000000000000000000000000001";
const second = "0x0000000000000000000000000000000000000002";
function fixture() {
	const workbook = XLSX.utils.book_new();
	for (const partner of AIRDROP_PARTNERS) {
		XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
			["Snapshot metadata"],
			["address", "amount", "Airdrop share", "veSOLV3"],
			[owner, 123456789, 1, 1000000],
			["Total", "", 1, 1000000],
		]), partner);
	}
	return workbook;
}

test("eight partner budgets (Ramses/Nile at half, Equalizer/Scale full); source holdings ignored", () => {
	const snapshot = parseAirdropSnapshot(fixture());
	assert.equal(snapshot.totalAmountRaw, "7000000000000000");
	assert.equal(snapshot.reservedAmount, 3000000);
	assert.equal(snapshot.allocations[owner].amount, 7000000);
	assert.equal(snapshot.partners.length, 8);
	assert.equal(snapshot.allocations[owner].partnerAmountsRaw.Equalizer, "1000000000000000");
	assert.equal(snapshot.allocations[owner].partnerAmountsRaw.Scale, "1000000000000000");
	assert.equal(snapshot.allocations[owner].partnerAmountsRaw.Ramses, "500000000000000");
	assert.equal(snapshot.allocations[owner].partnerAmountsRaw.Nile, "500000000000000");
	assert.equal(snapshot.allocations[owner].partnerAmountsRaw.THENA, "1000000000000000");
});

test("repeat imports replace grants; stale unclaimed grants removed; claimed metadata preserved", () => {
	const snapshot = parseAirdropSnapshot(fixture());
	const existing = structuredClone(snapshot.allocations);
	existing[owner].minted = true;
	existing[owner].mintedSignature = "previous-tx";
	existing[owner].solanaAddress = "destination";
	existing[second] = { ethAddress: second, amount: 123, minted: false, locked: false };
	const first = reconcileAirdropSnapshot(existing, snapshot);
	assert.equal(first.removed, 1);
	assert.equal(first.allocations[owner].mintedSignature, "previous-tx");
	assert.equal(first.allocations[owner].minted, true);
	assert.equal(first.allocations[owner].solanaAddress, "destination");
	assert.deepEqual(reconcileAirdropSnapshot(first.allocations, snapshot).allocations, first.allocations);
	assert.equal(reconcileAirdropSnapshot(first.allocations, snapshot).updated, 0);
});

test("cannot modify or remove claimed grants", () => {
	const snapshot = parseAirdropSnapshot(fixture());
	const existing = structuredClone(snapshot.allocations);
	existing[owner].locked = true;
	existing[owner].amountRaw = "1";
	assert.throws(() => reconcileAirdropSnapshot(existing, snapshot), /previously claimed/);
	assert.throws(() => reconcileAirdropSnapshot({ [second]: { ethAddress: second, amount: 1, minted: true, locked: false } }, snapshot), /previously claimed/);
});

test("duplicate rows aggregated and fractional shares round to exact base-unit budget", () => {
	const book = fixture();
	book.Sheets.THENA = XLSX.utils.aoa_to_sheet([
		["OWNER", "Airdrop share"], [owner, 0.333333333333], [owner, 0.333333333333], [second, 0.333333333333],
	]);
	const snapshot = parseAirdropSnapshot(book);
	assert.equal(snapshot.allocations[owner].partnerAmountsRaw.THENA, "666666666666667");
	assert.equal(snapshot.allocations[second].partnerAmountsRaw.THENA, "333333333333333");
	assert.equal(snapshot.totalAmountRaw, "7000000000000000");
});

test("reject missing/extra tabs, incomplete shares and bad addresses", () => {
	const missing = fixture(); missing.SheetNames.pop();
	assert.throws(() => parseAirdropSnapshot(missing), /complete workbook/);
	const extra = fixture(); extra.SheetNames.push("Unexpected");
	assert.throws(() => parseAirdropSnapshot(extra), /complete workbook/);
	for (const share of [0.9, -0.1, 2, "NaN", ""]) {
		const book = fixture(); book.Sheets.Ramses.C3 = { t: "n", v: share };
		assert.throws(() => parseAirdropSnapshot(book), /shares must total|invalid Airdrop share/);
	}
	const invalid = fixture(); invalid.Sheets.Nile.A3 = { t: "s", v: "not-an-address" };
	assert.throws(() => parseAirdropSnapshot(invalid), /invalid or missing EVM address/);
});

const sourcePath = process.env.AIRDROP_SOURCE_XLSX ?? process.argv[2];
function toCsv(snapshot) {
	return "evm_address,solv3_amount,raw_amount_9_decimals,partner_allocations_raw\n" + Object.values(snapshot.allocations).map((a) => `${a.ethAddress},${a.amount},${a.amountRaw},${Object.entries(a.partnerAmountsRaw).map(([k, v]) => `${k}:${v}`).join(";")}`).join("\n");
}
test("CSV accepts the export schema, preserves addresses and exact per-partner grants", () => {
	const snapshot = parseAirdropSnapshot(fixture());
	const csv = toCsv(snapshot);
	const imported = parseAirdropUpload(new TextEncoder().encode(csv), "recipients.csv");
	assert.deepEqual(imported.allocations, snapshot.allocations);
	assert.equal(imported.totalAmountRaw, "7000000000000000");
	assert.equal(reconcileAirdropSnapshot(imported.allocations, imported).updated, 0);
	for (const invalid of [
		csv.replace("7000000,", "5000000,"),
		csv.replace("THENA:1000000000000000", "Unknown:1000000000000000"),
		csv + "\n" + csv.split("\n")[1],
		csv.split("\n").slice(0, -1).join("\n"),
		"OWNER,veSOLV3\n" + owner + ",7000000",
	]) assert.throws(() => parseAirdropUpload(new TextEncoder().encode(invalid), "recipients.csv"));
});
if (process.argv[3]) {
	test("actual supplied recipients.csv equals all original workbook allocations", () => {
		const csv = parseAirdropUpload(readFileSync(process.argv[3]), "recipients.csv");
		const workbook = parseAirdropUpload(readFileSync(sourcePath), "source.xlsx");
		assert.deepEqual(csv.allocations, workbook.allocations);
		assert.equal(Object.keys(csv.allocations).length, 4252);
	});
}
if (sourcePath) {
	test("published source: exact assigned total across all partners", () => {
		const snapshot = parseAirdropSnapshot(XLSX.read(readFileSync(sourcePath), { type: "buffer" }));
		const expectedTotal = Object.values(PARTNER_BUDGETS).reduce((sum, value) => sum + BigInt(value), 0n) * 1_000_000_000n;
		assert.equal(Object.values(snapshot.allocations).reduce((sum, a) => sum + BigInt(a.amountRaw), 0n), expectedTotal);
		for (const partner of AIRDROP_PARTNERS) {
			const expected = BigInt(PARTNER_BUDGETS[partner]) * 1_000_000_000n;
			assert.equal(Object.values(snapshot.allocations).reduce((sum, a) => sum + BigInt(a.partnerAmountsRaw[partner] ?? 0), 0n), expected);
		}
	});
}
