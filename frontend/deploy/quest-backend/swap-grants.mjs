// Least-privilege grants for the Devnet swap source. One definition used by apply-schema (production)
// and by the PGlite rehearsal, so what is tested is what is deployed.
//
//   indexer: the worker. Writes the Genesis ledger it needs, reads nothing from Quest except identity.
//   reader:  the backend's progress provider. Read-only on the ledger and the Quest tables the
//            qualification reader joins; it cannot write anything.
export const indexerGrants = (role) => [
	`GRANT USAGE ON SCHEMA genesis TO ${role}`,
	`GRANT SELECT ON genesis.campaigns TO ${role}`,
	`GRANT SELECT, UPDATE ON genesis.indexer_cursors TO ${role}`,
	`GRANT SELECT, INSERT ON genesis.chain_events TO ${role}`,
	// FOR SHARE (valuation row lock) needs some UPDATE privilege; the immutability trigger still
	// refuses every real UPDATE or DELETE of an event.
	`GRANT UPDATE (ingested_at) ON genesis.chain_events TO ${role}`,
	`GRANT SELECT, INSERT, UPDATE ON genesis.ingest_conflicts TO ${role}`,
	`GRANT SELECT, INSERT ON genesis.swap_valuations TO ${role}`,
	`GRANT SELECT, INSERT ON genesis.lp_value_snapshots TO ${role}`,
	`GRANT USAGE ON SCHEMA quest TO ${role}`,
	`GRANT SELECT ON quest.environment_identity TO ${role}`,
	// Voting XP evidence (migration 020). The worker records what it read from the ve program; it cannot
	// read or write Levels.
	`GRANT SELECT, INSERT ON quest.vote_observations, quest.vote_epoch_heads TO ${role}`,
	// Pool price samples for range-aware LP quests (migration 023). Append-only evidence.
	`GRANT SELECT, INSERT ON quest.pool_tick_samples TO ${role}`,
];
export const readerGrants = (role) => [
	`GRANT USAGE ON SCHEMA genesis TO ${role}`,
	`GRANT SELECT ON genesis.campaigns, genesis.indexer_cursors, genesis.chain_events, genesis.ingest_conflicts, genesis.swap_valuations, genesis.lp_value_snapshots TO ${role}`,
	`GRANT USAGE ON SCHEMA quest TO ${role}`,
	`GRANT SELECT ON quest.environment_identity, quest.wallet_links, quest.wallet_bindings, quest.passports, quest.referrals, quest.pool_tick_samples TO ${role}`,
	`GRANT SELECT ON quest.lp_inventory_cohorts, quest.position_baseline_anchors, quest.position_timeline_clocks, quest.position_timeline_coverage, quest.position_timeline_ranges, quest.position_timeline_conflicts, quest.position_ownership_conflicts, quest.position_ownership_evidence TO ${role}`,
];

// The XP settler: everything the reader can see, plus exactly what the weekly receipt store needs.
// It inserts receipts; the SECURITY DEFINER trigger (migration 018) writes the XP, so this login
// has no access to xp_events beyond reading.
export const xpWriterGrants = (role) => [
	...readerGrants(role),
	`GRANT SELECT ON quest.calendar_plans, quest.calendar_plan_revisions, quest.calendar_milestones, quest.community_test_policies, quest.weekly_test_policies, quest.xp_events TO ${role}`,
	`GRANT SELECT, INSERT ON quest.weekly_test_receipts TO ${role}`,
	`GRANT EXECUTE ON FUNCTION quest.lock_weekly_test_source(text), quest.lock_lp_test_source(text,text,bigint,bigint), quest.lock_lp_inventory_source(text,bigint,jsonb,bigint) TO ${role}`,
	// Voting XP: the settler may only run the trusted function that awards the +1 per ended epoch.
	`GRANT EXECUTE ON FUNCTION quest.settle_voting_epochs() TO ${role}`,
	// The settler reads the pause switches (migration 022) before it records weekly receipts.
	`GRANT EXECUTE ON FUNCTION quest.pause_status() TO ${role}`,
];

// The serving roles read one Passport's Voting XP through a SECURITY DEFINER function, never the tables.
export const votingRuntimeGrants = (role) => [
	`GRANT USAGE ON SCHEMA quest TO ${role}`,
	`GRANT EXECUTE ON FUNCTION quest.voting_overview(uuid) TO ${role}`,
	`GRANT EXECUTE ON FUNCTION quest.pause_status() TO ${role}`,
];

// The pause admin login: it can read the switches and move one, and do nothing else. Only the admin
// pause endpoint of the Quest backend connects with it.
export const pauseAdminGrants = (role) => [
	`GRANT USAGE ON SCHEMA quest TO ${role}`,
	// The server checks the environment pins at startup, like the enrollment role.
	`GRANT SELECT ON quest.environment_identity TO ${role}`,
	`GRANT EXECUTE ON FUNCTION quest.pause_status(), quest.set_pause(text,boolean,text,text) TO ${role}`,
];

// A player's own goal list (migration 024) is read through a SECURITY DEFINER function by the serving roles; they get
// no table access and cannot run the operator functions.
export const communityGoalReadGrants = (role) => [
	`GRANT USAGE ON SCHEMA quest TO ${role}`,
	`GRANT EXECUTE ON FUNCTION quest.community_goals_overview(uuid,text) TO ${role}`,
];

// The quest admin login: only the website's admin route (a signed admin wallet, a shared token, the private network)
// connects with it. It runs the calendar store's publish and revise, and the manual goal functions, and nothing
// else: no XP table access, no operator-grant tables, no other function.
export const questAdminGrants = (role) => [
	`GRANT USAGE ON SCHEMA quest TO ${role}`,
	`GRANT SELECT ON quest.environment_identity TO ${role}`,
	`GRANT SELECT, INSERT ON quest.calendar_plans, quest.calendar_plan_revisions, quest.calendar_admin_audit TO ${role}`,
	`GRANT EXECUTE ON FUNCTION quest.save_manual_goal(text,text,text,text,timestamptz,timestamptz,integer,text), quest.remove_manual_goal(text,text,text), quest.complete_manual_goal(text,text,text,text), quest.manual_goals_admin(text) TO ${role}`,
	`GRANT USAGE ON SEQUENCE quest.calendar_admin_audit_audit_id_seq TO ${role}`,
	// Partner Scout (migration 025): review leads and pay the bounty when a partner is onboarded.
	`GRANT EXECUTE ON FUNCTION quest.partner_leads_admin(), quest.reject_partner_lead(bigint,text,text), quest.onboard_partner_lead(bigint,text,text) TO ${role}`,
];

// The serving roles let a Passport send a partner lead and read its own leads (migration 025) through SECURITY DEFINER
// functions only; they get no table access.
export const partnerScoutRuntimeGrants = (role) => [
	`GRANT USAGE ON SCHEMA quest TO ${role}`,
	`GRANT EXECUTE ON FUNCTION quest.submit_partner_lead(uuid,text,text,text), quest.partner_scout_overview(uuid) TO ${role}`,
	// Social quests (migration 026): claim once and read the player's own state, through SECURITY DEFINER functions only.
	`GRANT EXECUTE ON FUNCTION quest.claim_social_quest(uuid,text), quest.social_quests_overview(uuid) TO ${role}`,
];

// Dedicated trusted LP evidence publisher. It cannot enroll users, mint Passes,
// change the immutable selected inventory, write XP or mutate the calendar.
export const timelinePublisherGrants = (role) => [
 `GRANT USAGE ON SCHEMA quest TO ${role}`,
 `GRANT SELECT ON quest.lp_inventory_cohorts TO ${role}`,
 `GRANT SELECT ON quest.environment_identity, quest.position_baseline_anchors, quest.position_ownership_evidence, quest.position_ownership_conflicts TO ${role}`,
 `GRANT SELECT, INSERT ON quest.position_timeline_clocks, quest.position_timeline_ranges, quest.position_timeline_conflicts TO ${role}`,
 `GRANT SELECT, INSERT, UPDATE ON quest.position_timeline_coverage TO ${role}`,
];
