import { verifyGenesisReferralProof } from "./referralProof.ts";
import type { SqlPool } from "./sqlLedger";

type CampaignRow = { is_open: boolean };
type CycleRow = { unsafe: boolean };
type ReferralRow = { referrer_wallet: string };

/** Captures a referee's signed choice once; clicks and connections never award credit. */
export async function captureGenesisReferral(input: {
	pool: SqlPool;
	campaignId: string;
	refereeWallet: string;
	referrerWallet: string;
	issuedAtMs: number;
	message: string;
	signatureBase64: string;
}): Promise<{ written: boolean }> {
	const { pool, campaignId, refereeWallet, referrerWallet } = input;
	if (!verifyGenesisReferralProof(input))
		throw new Error("Invalid or expired Genesis referral signature.");
	const client = await pool.connect();
	let inTransaction = false;
	try {
		await client.query("BEGIN");
		inTransaction = true;
		// Serializes referrals within the campaign, including opposite-direction links.
		const campaign = await client.query<CampaignRow>(
			`SELECT status = 'active' AND starts_at <= now()
			   AND ends_at > now() AS is_open
			 FROM genesis.campaigns WHERE id = $1 FOR UPDATE`,
			[campaignId],
		);
		if (campaign.rows.length !== 1 || campaign.rows[0].is_open !== true)
			throw new Error("Genesis referral campaign is not open.");
		const existing = await client.query<ReferralRow>(
			`SELECT referrer_wallet FROM genesis.referrals
			 WHERE campaign_id = $1 AND referee_wallet = $2`,
			[campaignId, refereeWallet],
		);
		if (existing.rows.length > 0) {
			if (
				existing.rows.length !== 1 ||
				existing.rows[0].referrer_wallet !== referrerWallet
			)
				throw new Error("Genesis referral attribution is already bound.");
			await client.query("COMMIT");
			inTransaction = false;
			return { written: false };
		}
		const lineage = await client.query<CycleRow>(
			`WITH RECURSIVE lineage AS (
			 SELECT referee_wallet, referrer_wallet,
			        ARRAY[referee_wallet] AS seen, false AS has_cycle, 1 AS depth
			 FROM genesis.referrals
			 WHERE campaign_id = $1 AND referee_wallet = $2
			 UNION ALL
			 SELECT r.referee_wallet, r.referrer_wallet,
			        l.seen || r.referee_wallet,
			        r.referee_wallet = ANY(l.seen) AS has_cycle,
			        l.depth + 1 AS depth
			 FROM genesis.referrals r
			 JOIN lineage l ON r.referee_wallet = l.referrer_wallet
			 WHERE r.campaign_id = $1 AND NOT l.has_cycle AND l.depth < 256
			)
			SELECT EXISTS (
			 SELECT 1 FROM lineage
			 WHERE referee_wallet = $3 OR referrer_wallet = $3
			    OR has_cycle OR depth >= 256
			) AS unsafe`,
			[campaignId, referrerWallet, refereeWallet],
		);
		if (lineage.rows.length !== 1 || lineage.rows[0].unsafe !== false)
			throw new Error("Genesis referral would create a circular attribution.");
		const inserted = await client.query(
			`INSERT INTO genesis.referrals
			 (campaign_id, referee_wallet, referrer_wallet, attribution_source)
			 VALUES ($1, $2, $3, 'wallet_signature_v1')
			 ON CONFLICT (campaign_id, referee_wallet) DO NOTHING
			 RETURNING referee_wallet`,
			[campaignId, refereeWallet, referrerWallet],
		);
		if (inserted.rowCount !== 1) {
			const raced = await client.query<ReferralRow>(
				`SELECT referrer_wallet FROM genesis.referrals
				 WHERE campaign_id = $1 AND referee_wallet = $2`,
				[campaignId, refereeWallet],
			);
			if (
				raced.rows.length !== 1 ||
				raced.rows[0].referrer_wallet !== referrerWallet
			)
				throw new Error("Genesis referral attribution is already bound.");
		}
		await client.query("COMMIT");
		inTransaction = false;
		return { written: inserted.rowCount === 1 };
	} catch (error) {
		if (inTransaction) await client.query("ROLLBACK");
		throw error;
	} finally {
		client.release();
	}
}
