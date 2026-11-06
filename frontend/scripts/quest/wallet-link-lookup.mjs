import { assertPassportId } from "./passport-id.mjs";

const WALLET = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/**
 * Read-only active owner lookup for a future server-side Passport auth route.
 * The caller must supply a connection obtained through verified Devnet startup.
 * This module opens no database and never creates or changes a link.
 */
export async function activePassportForWallet(connection, wallet) {
	if (typeof connection?.query !== "function") {
		throw new TypeError("wallet link lookup: a query connection is required");
	}
	if (typeof wallet !== "string" || !WALLET.test(wallet)) {
		throw new TypeError("wallet link lookup: invalid Devnet wallet");
	}
	const result = await connection.query(
		`SELECT passport_id::text AS passport_id FROM quest.wallet_links
		 WHERE network = 'DEVNET' AND wallet = $1 AND unlinked_at IS NULL
		   AND linked_at <= now() LIMIT 2`,
		[wallet],
	);
	if (!Array.isArray(result?.rows) || result.rows.length > 1) {
		throw new Error("wallet link lookup: invalid active ownership result");
	}
	return result.rows.length === 0
		? null
		: assertPassportId(result.rows[0]?.passport_id);
}

export async function isWalletLinkedToPassport(connection, passportId, wallet) {
	const expected = assertPassportId(passportId);
	return (await activePassportForWallet(connection, wallet)) === expected;
}
