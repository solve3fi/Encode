import Decimal from "decimal.js";
import * as XLSX from "xlsx";
import type { AirdropAllocations } from "../configs/airdropTypes";

export const AIRDROP_PARTNERS = ["THENA", "Ramses", "Nile", "Lynex", "Aerodrome", "Velodrome", "Equalizer", "Scale"] as const;
export const PARTNER_ALLOCATION = 1_000_000;
// Equalizer users can hold either EQUAL (Fantom) or SCALE (Base) -- Equalizer
// and Scale are split into two separate partner buckets, each getting a full
// standard partner budget (not halved -- Scale would otherwise get nothing,
// and this doubles Equalizer's original slice rather than splitting it).
// Ramses and Nile were separately cut to half a standard budget each (not
// paired the way Equalizer/Scale are -- this just shrinks the total assigned
// and grows RESERVED_ALLOCATION).
const HALF_PARTNER_ALLOCATION = PARTNER_ALLOCATION / 2;
export const PARTNER_BUDGETS: Record<(typeof AIRDROP_PARTNERS)[number], number> = {
	THENA: PARTNER_ALLOCATION, Ramses: HALF_PARTNER_ALLOCATION, Nile: HALF_PARTNER_ALLOCATION,
	Lynex: PARTNER_ALLOCATION, Aerodrome: PARTNER_ALLOCATION, Velodrome: PARTNER_ALLOCATION,
	Equalizer: PARTNER_ALLOCATION, Scale: PARTNER_ALLOCATION,
};
export const COMMUNITY_ALLOCATION = 10_000_000;
export const ASSIGNED_ALLOCATION = Object.values(PARTNER_BUDGETS).reduce((sum, value) => sum + value, 0);
export const RESERVED_ALLOCATION = COMMUNITY_ALLOCATION - ASSIGNED_ALLOCATION;
const D = Decimal.clone({ precision: 80 });
const UNIT = new D(1_000_000_000);
const partnerBudget = (partner: string) => new D(PARTNER_BUDGETS[partner as (typeof AIRDROP_PARTNERS)[number]]).mul(UNIT);
const ADDRESS = /^0x[a-fA-F0-9]{40}$/;

export type PartnerSummary = { partner: string; rows: number; wallets: number; amount: number; amountRaw: string; sourceShareTotal: string };
export type AirdropSnapshot = { allocations: AirdropAllocations; partners: PartnerSummary[]; totalAmount: number; totalAmountRaw: string; reservedAmount: number };

/** Import the lossless recipients.csv export without CSV numeric inference
 * (EVM addresses and base-unit integers must remain strings). */
export function parseAirdropUpload(bytes: Uint8Array, filename: string): AirdropSnapshot {
	if (!/\.csv$/i.test(filename)) return parseAirdropSnapshot(XLSX.read(bytes, { type: "array" }));
	// Force comma as the field separator: SheetJS auto-detects the CSV
	// delimiter by comparing character frequency per line, and the semicolon-
	// separated partner_allocations_raw field can outnumber this format's 3
	// real commas once enough partners are listed (this broke at 8, plausibly
	// only just clearing 7) -- silently misparsing every row as one giant
	// semicolon-delimited column instead of throwing.
	const book = XLSX.read(bytes, { type: "array", raw: true, FS: "," });
	const rows = XLSX.utils.sheet_to_json<string[]>(book.Sheets[book.SheetNames[0]], { header: 1, defval: "", raw: true });
	const headers = rows[0]?.map((value) => String(value).trim().toLowerCase());
	const columns = ["evm_address", "solv3_amount", "raw_amount_9_decimals", "partner_allocations_raw"].map((name) => headers?.indexOf(name) ?? -1);
	if (columns.some((index) => index < 0)) throw new Error("Select the reconciled recipients.csv export with evm_address, solv3_amount, raw_amount_9_decimals and partner_allocations_raw columns, or the original seven-tab workbook.");
	const allocations: AirdropAllocations = {};
	const totals = new Map<string, Decimal>(AIRDROP_PARTNERS.map((name) => [name, new D(0)]));
	const counts = new Map<string, number>();
	for (let index = 1; index < rows.length; index++) {
		const row = rows[index];
		if (row.every((value) => String(value).trim() === "")) continue;
		const [owner, amount, raw, breakdown] = columns.map((column) => String(row[column] ?? "").trim());
		const key = owner.toLowerCase();
		if (!ADDRESS.test(owner) || allocations[key]) throw new Error(`CSV row ${index + 1}: invalid or duplicate EVM address`);
		if (!/^[1-9]\d*$/.test(raw) || !/^\d+(\.\d{1,9})?$/.test(amount) || !new D(amount).mul(UNIT).eq(raw)) throw new Error(`CSV row ${index + 1}: invalid or mismatched token amount`);
		const partnerAmountsRaw: Record<string, string> = {};
		for (const part of breakdown.split(";")) {
			const pieces = part.split(":");
			const [name, value] = pieces;
			if (pieces.length !== 2 || !totals.has(name) || partnerAmountsRaw[name] || !/^[1-9]\d*$/.test(value)) throw new Error(`CSV row ${index + 1}: invalid partner allocation`);
			partnerAmountsRaw[name] = value;
			totals.set(name, totals.get(name)!.plus(value));
			counts.set(name, (counts.get(name) ?? 0) + 1);
		}
		if (!Object.values(partnerAmountsRaw).reduce((sum, value) => sum.plus(value), new D(0)).eq(raw)) throw new Error(`CSV row ${index + 1}: partner allocations do not match wallet total`);
		allocations[key] = { ethAddress: key, amount: new D(raw).div(UNIT).toNumber(), amountRaw: raw, partnerAmountsRaw, minted: false, locked: false };
	}
	const partners = AIRDROP_PARTNERS.map((partner) => {
		const budget = partnerBudget(partner);
		if (!totals.get(partner)!.eq(budget)) throw new Error(`${partner}: CSV allocations must total exactly ${PARTNER_BUDGETS[partner]} SOLV3`);
		return { partner, rows: counts.get(partner) ?? 0, wallets: counts.get(partner) ?? 0, amount: PARTNER_BUDGETS[partner], amountRaw: budget.toFixed(0), sourceShareTotal: "1" };
	});
	return { allocations, partners, totalAmount: ASSIGNED_ALLOCATION, totalAmountRaw: new D(ASSIGNED_ALLOCATION).mul(UNIT).toFixed(0), reservedAmount: RESERVED_ALLOCATION };
}

/** A complete snapshot across every AIRDROP_PARTNERS tab. Source holdings are
 * deliberately NOT grant amounts: Airdrop share determines each wallet's
 * portion of its partner's fixed budget (see PARTNER_BUDGETS). */
export function parseAirdropSnapshot(workbook: XLSX.WorkBook): AirdropSnapshot {
	if (workbook.SheetNames.length !== AIRDROP_PARTNERS.length || AIRDROP_PARTNERS.some((name) => !workbook.SheetNames.includes(name))) {
		throw new Error(`Upload the complete workbook with exactly these tabs: ${AIRDROP_PARTNERS.join(", ")}`);
	}
	const allocations: AirdropAllocations = {};
	const partners: PartnerSummary[] = [];
	for (const partner of AIRDROP_PARTNERS) {
		const rows = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[partner], { header: 1, defval: "", raw: true });
		const headerIndex = rows.findIndex((row) => {
			const cells = row.map((v) => String(v).trim().toLowerCase());
			return cells.includes("airdrop share") && (cells.includes("owner") || cells.includes("address"));
		});
		if (headerIndex < 0) throw new Error(`${partner}: missing address/OWNER and Airdrop share headers`);
		const headers = rows[headerIndex].map((v) => String(v).trim().toLowerCase());
		const ownerCol = headers.findIndex((v) => v === "owner" || v === "address");
		const shareCol = headers.indexOf("airdrop share");
		const shares = new Map<string, Decimal>();
		let count = 0;
		for (let index = headerIndex + 1; index < rows.length; index++) {
			const row = rows[index];
			const owner = String(row[ownerCol] ?? "").trim().toLowerCase();
			if (owner === "total" || (!owner && String(row[0]).trim().toLowerCase() === "total") || row.every((cell) => cell === "" || cell == null)) continue;
			if (!ADDRESS.test(owner)) throw new Error(`${partner} row ${index + 1}: invalid or missing EVM address`);
			let share: Decimal;
			try {
				const cell = row[shareCol];
				if (typeof cell !== "number" && typeof cell !== "string") throw new Error();
				const value = String(cell).trim();
				share = value.endsWith("%") ? new D(value.slice(0, -1)).div(100) : new D(value);
				if (!share.isFinite() || share.lt(0) || share.gt(1)) throw new Error();
			} catch {
				throw new Error(`${partner} row ${index + 1}: invalid Airdrop share`);
			}
			shares.set(owner, (shares.get(owner) ?? new D(0)).plus(share));
			count++;
		}
		const total = [...shares.values()].reduce((sum, share) => sum.plus(share), new D(0));
		// Tolerate only spreadsheet rounding, not incomplete recipient lists.
		if (total.minus(1).abs().gt("0.000000001")) throw new Error(`${partner}: shares must total 100% (got ${total.mul(100)}%)`);
		const budget = partnerBudget(partner);
		// Aggregate duplicates before rounding, then use largest remainders so
		// each partner distributes its full budget at nine decimals.
		const grants = [...shares].map(([owner, share]) => {
			const quota = share.div(total).mul(budget);
			return { owner, raw: quota.floor(), remainder: quota.minus(quota.floor()) };
		});
		grants.sort((a, b) => b.remainder.comparedTo(a.remainder) || (a.owner < b.owner ? -1 : a.owner > b.owner ? 1 : 0));
		const remainder = budget.minus(grants.reduce((sum, grant) => sum.plus(grant.raw), new D(0))).toNumber();
		if (!Number.isSafeInteger(remainder) || remainder < 0 || remainder > grants.length) throw new Error(`${partner}: invalid rounding remainder`);
		for (let index = 0; index < grants.length; index++) {
			const grant = grants[index];
			const raw = grant.raw.plus(index < remainder ? 1 : 0);
			if (raw.isZero()) continue;
			const previous = allocations[grant.owner];
			const amountRaw = new D(previous?.amountRaw ?? 0).plus(raw).toFixed(0);
			allocations[grant.owner] = {
				ethAddress: grant.owner, amount: new D(amountRaw).div(UNIT).toNumber(), amountRaw,
				partnerAmountsRaw: { ...previous?.partnerAmountsRaw, [partner]: raw.toFixed(0) },
				minted: false, locked: false,
			};
		}
		partners.push({ partner, rows: count, wallets: shares.size, amount: PARTNER_BUDGETS[partner], amountRaw: budget.toFixed(0), sourceShareTotal: total.toString() });
	}
	const ordered = Object.fromEntries(Object.entries(allocations).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
	const totalRaw = Object.values(ordered).reduce((sum, allocation) => sum.plus(allocation.amountRaw!), new D(0));
	if (!totalRaw.eq(new D(ASSIGNED_ALLOCATION).mul(UNIT))) throw new Error(`Allocation total does not equal ${ASSIGNED_ALLOCATION.toLocaleString()} SOLV3`);
	return { allocations: ordered, partners, totalAmount: ASSIGNED_ALLOCATION, totalAmountRaw: totalRaw.toFixed(0), reservedAmount: RESERVED_ALLOCATION };
}

/** Replace a full snapshot, never add another copy of its grants. Refuse to
 * change or delete any previously claimed/locked allocation. */
export function reconcileAirdropSnapshot(existing: AirdropAllocations, snapshot: AirdropSnapshot) {
	const next: AirdropAllocations = structuredClone(snapshot.allocations);
	for (const [address, allocation] of Object.entries(existing)) {
		if (!allocation.minted && !allocation.locked && !allocation.mintedSignature && !allocation.lockedSignature) continue;
		const replacement = next[address];
		const previousRaw = allocation.amountRaw ?? new D(allocation.amount).mul(UNIT).toFixed(0);
		if (!replacement || replacement.amountRaw !== previousRaw) throw new Error(`Cannot change previously claimed allocation: ${address}`);
		next[address] = { ...allocation, ...replacement, solanaAddress: allocation.solanaAddress, minted: allocation.minted, locked: allocation.locked };
	}
	const added = Object.keys(next).filter((address) => !existing[address]).length;
	const updated = Object.keys(next).filter((address) => existing[address] && (existing[address].amountRaw ?? new D(existing[address].amount).mul(UNIT).toFixed(0)) !== next[address].amountRaw).length;
	return { allocations: next, added, updated, removed: Object.keys(existing).filter((address) => !next[address]).length };
}
