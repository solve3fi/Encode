-- Durable authenticated actor receipts, committed with calendar writes.
BEGIN;
CREATE TABLE quest.calendar_admin_audit (
 audit_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 campaign_id text NOT NULL REFERENCES quest.calendar_plans(campaign_id),
 revision integer NOT NULL CHECK(revision > 0),
 action text NOT NULL CHECK(action IN ('PUBLISH','REVISE')),
 actor_wallet text NOT NULL CHECK(length(actor_wallet) BETWEEN 32 AND 44 AND actor_wallet ~ '^[1-9A-HJ-NP-Za-km-z]+$'),
 plan_sha256 text NOT NULL CHECK(plan_sha256 ~ '^[0-9a-f]{64}$'),
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(campaign_id,revision)
);
REVOKE ALL ON quest.calendar_admin_audit FROM PUBLIC;
CREATE TRIGGER calendar_admin_audit_immutable BEFORE UPDATE OR DELETE ON quest.calendar_admin_audit
 FOR EACH ROW EXECUTE FUNCTION quest.guard_partner_scout_history();
CREATE TRIGGER calendar_admin_audit_no_truncate BEFORE TRUNCATE ON quest.calendar_admin_audit
 FOR EACH STATEMENT EXECUTE FUNCTION quest.guard_partner_scout_history();
COMMIT;
