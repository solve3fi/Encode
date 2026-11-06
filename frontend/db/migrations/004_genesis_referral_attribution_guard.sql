-- Attribution identity is permanent. Review may change qualification status,
-- but must never reassign a referee to a different referrer or delete history.
BEGIN;

CREATE FUNCTION genesis.retain_referral_attribution() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Genesis referral attribution cannot be deleted';
    END IF;
    IF NEW.campaign_id IS DISTINCT FROM OLD.campaign_id
       OR NEW.referee_wallet IS DISTINCT FROM OLD.referee_wallet
       OR NEW.referrer_wallet IS DISTINCT FROM OLD.referrer_wallet
       OR NEW.attributed_at IS DISTINCT FROM OLD.attributed_at
       OR NEW.attribution_source IS DISTINCT FROM OLD.attribution_source THEN
        RAISE EXCEPTION 'Genesis referral attribution cannot be reassigned';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER referrals_retain_attribution BEFORE UPDATE OR DELETE
    ON genesis.referrals FOR EACH ROW
    EXECUTE FUNCTION genesis.retain_referral_attribution();

COMMIT;
