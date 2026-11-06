import Decimal from "decimal.js";
import * as XLSX from "xlsx";
import type { PresaleAllocations } from "../configs/presaleTypes";

const D = Decimal.clone({ precision: 80 });
const UNIT = new D(1_000_000_000);
const SOLANA_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export type PresaleSnapshot = {
	allocations: PresaleAllocations;
	totalUsd: number;
	totalVeSolv3: number;
	totalAmountRaw: string;
};

/** Parses a CSV/XLSX with columns solana_address, amount_usd,
 * ve_solv3_amount — no CSV numeric inference, so large integers and
 * addresses survive intact. veSolv3Amount is taken as authoritative from
 * the sheet rather than recomputed from amountUsd, since it's already the
 * reconciled figure buyers were quoted. */
export function parsePresaleUpload(bytes: Uint8Array, filename: string): PresaleSnapshot {
	const workbook = /\.csv$/i.test(filename)
		? XLSX.read(bytes, { type: "array", raw: true })
		: XLSX.read(bytes, { type: "array" });
	const rows = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[workbook.SheetNames[0]], { header: 1, defval: "", raw: true });
	const headers = rows[0]?.map((value) => String(value).trim().toLowerCase());
	const columns = ["solana_address", "amount_usd", "ve_solv3_amount"].map((name) => headers?.indexOf(name) ?? -1);
	if (columns.some((index) => index < 0)) {
		throw new Error("Select a CSV/XLSX with solana_address, amount_usd and ve_solv3_amount columns.");
	}

	const allocations: PresaleAllocations = {};
	let totalUsdRaw = new D(0);
	let totalRaw = new D(0);
	for (let index = 1; index < rows.length; index++) {
		const row = rows[index];
		if (row.every((value) => String(value).trim() === "")) continue;
		const [address, usdCell, veSolv3Cell] = columns.map((column) => String(row[column] ?? "").trim());
		if (!SOLANA_ADDRESS.test(address) || allocations[address]) {
			throw new Error(`Row ${index + 1}: invalid or duplicate Solana address`);
		}
		if (!/^\d+(\.\d+)?$/.test(usdCell)) {
			throw new Error(`Row ${index + 1}: invalid amount_usd`);
		}
		if (!/^\d+(\.\d+)?$/.test(veSolv3Cell)) {
			throw new Error(`Row ${index + 1}: invalid ve_solv3_amount`);
		}
		const veSolv3Amount = new D(veSolv3Cell);
		if (veSolv3Amount.lte(0)) {
			throw new Error(`Row ${index + 1}: ve_solv3_amount must be positive`);
		}
		const amountRaw = veSolv3Amount.mul(UNIT).round().toFixed(0);
		allocations[address] = {
			solanaAddress: address,
			amountUsd: new D(usdCell).toNumber(),
			veSolv3Amount: veSolv3Amount.toNumber(),
			amountRaw,
			minted: false,
			locked: false,
		};
		totalUsdRaw = totalUsdRaw.plus(usdCell);
		totalRaw = totalRaw.plus(amountRaw);
	}

	if (Object.keys(allocations).length === 0) {
		throw new Error("No allocation rows found");
	}

	return {
		allocations,
		totalUsd: totalUsdRaw.toNumber(),
		totalVeSolv3: new D(totalRaw).div(UNIT).toNumber(),
		totalAmountRaw: totalRaw.toFixed(0),
	};
}

/** Same contract as reconcileAirdropSnapshot: replace the full snapshot, but
 * refuse to change or drop any allocation that's already been claimed or
 * locked. */
export function reconcilePresaleSnapshot(existing: PresaleAllocations, snapshot: PresaleSnapshot) {
	const next: PresaleAllocations = structuredClone(snapshot.allocations);
	for (const [address, allocation] of Object.entries(existing)) {
		if (!allocation.minted && !allocation.locked && !allocation.mintedSignature && !allocation.lockedSignature) continue;
		const replacement = next[address];
		if (!replacement || replacement.amountRaw !== allocation.amountRaw) {
			throw new Error(`Cannot change previously claimed allocation: ${address}`);
		}
		next[address] = { ...allocation, ...replacement, minted: allocation.minted, locked: allocation.locked };
	}
	const added = Object.keys(next).filter((address) => !existing[address]).length;
	const updated = Object.keys(next).filter((address) => existing[address] && existing[address].amountRaw !== next[address].amountRaw).length;
	const removed = Object.keys(existing).filter((address) => !next[address]).length;
	return { allocations: next, added, updated, removed };
}
