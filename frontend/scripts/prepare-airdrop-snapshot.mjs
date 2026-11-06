// Read-only with respect to the app ledger and chain. Writes a NEW draft artifact.
// Usage: node scripts/prepare-airdrop-snapshot.mjs source.xlsx output-directory
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import * as XLSX from "xlsx";
import { parseAirdropSnapshot } from "../src/lib/airdropSnapshot.ts";

const [source, output] = process.argv.slice(2);
if (!source || !output) throw new Error("Usage: node scripts/prepare-airdrop-snapshot.mjs source.xlsx NEW-output-directory");
const bytes = readFileSync(source);
const snapshot = parseAirdropSnapshot(XLSX.read(bytes, { type: "buffer" }));
const artifact = {
	status: "draft-not-active",
	sourceUrl: "https://docs.google.com/spreadsheets/d/1heeG2yIOkiwyF43G7lwxXzWzTjYJO4_dcRUUzpaLMxQ/edit",
	sourceSha256: createHash("sha256").update(bytes).digest("hex"),
	preparedAt: new Date().toISOString(),
	initialSupply: 100000000, communityAllocation: 10000000,
	rounding: "Normalize each partner's Airdrop share total; aggregate duplicate owners; distribute that partner's budget (PARTNER_BUDGETS in src/lib/airdropSnapshot.ts -- 1,000,000 SOLV3 for a full partner, 500,000 each for Equalizer and Scale) in 9-decimal base units by largest remainder, ties by lowercased address.",
	activationBlockedBy: "Current claim flow transfers liquid tokens before a separate optional lock. Enforce locked distribution before activation; reconcile again against latest claim state.",
	...snapshot,
};
const directory = resolve(output);
mkdirSync(directory); // Never overwrite an existing export directory.
writeFileSync(join(directory, "airdrop-draft.json"), JSON.stringify(artifact, null, 2) + "\n", { flag: "wx" });
const csv = ["evm_address,solv3_amount,raw_amount_9_decimals,partner_allocations_raw"];
for (const allocation of Object.values(snapshot.allocations)) {
	const raw = BigInt(allocation.amountRaw);
	const amount = `${raw / 1000000000n}.${(raw % 1000000000n).toString().padStart(9, "0")}`;
	csv.push(`${allocation.ethAddress},${amount},${raw},${Object.entries(allocation.partnerAmountsRaw).map(([name, value]) => `${name}:${value}`).join(";")}`);
}
writeFileSync(join(directory, "recipients.csv"), csv.join("\n") + "\n", { flag: "wx" });
console.log(JSON.stringify({ directory, recipients: Object.keys(snapshot.allocations).length, totalAmount: snapshot.totalAmount, reservedAmount: snapshot.reservedAmount, partners: snapshot.partners, sourceSha256: artifact.sourceSha256 }, null, 2));
