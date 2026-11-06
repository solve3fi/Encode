// One-time, idempotent: provision the TEST-ONLY weekly XP ceilings for the published calendar. Run
// as the schema OWNER role, never over HTTP. The policy row is immutable once written (a later
// change needs a reviewed migration), and the receipt guard enforces these ceilings in the database.
//
//   QUEST_OWNER_DB_URL, QUEST_CALENDAR_CAMPAIGN_ID
//
// The numbers are test ceilings chosen by the engineer, not an approved economic policy.
import pg from "pg";

const need = (name) => {
	const value = process.env[name];
	if (!value) throw new Error(`Missing required setting ${name}`);
	return value;
};
const campaignId = need("QUEST_CALENDAR_CAMPAIGN_ID");
const document = {
	fixtureKind: "SYNTHETIC_DEVNET",
	network: "DEVNET",
	revision: 1,
	perPassportEpochXp: "5000",
	perCampaignEpochXp: "500000",
	perCampaignYearXp: "20000000",
};
const client = new pg.Client({ connectionString: need("QUEST_OWNER_DB_URL") });
await client.connect();
try {
	// The guard trigger requires READ COMMITTED; a plain statement is fine.
	const { rowCount } = await client.query(
		"INSERT INTO quest.weekly_test_policies(campaign_id, document) VALUES($1, $2::jsonb) ON CONFLICT (campaign_id) DO NOTHING",
		[campaignId, JSON.stringify(document)],
	);
	console.log(
		JSON.stringify({ campaignId, provisioned: rowCount === 1, ceilings: document }),
	);
} finally {
	await client.end();
}
