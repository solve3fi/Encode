// Settlement pass shared by the XP settler service and its tests.
/**
 * One settlement pass over every Passport with a qualifying swap in the checked source.
 *
 * `settleVoting` is optional: it runs the database function that awards one governance Level per
 * Passport per ended epoch (Voting XP). Votes are an independent source, so it runs every round even
 * when the swap source is unavailable, and a failure there never stops swap settlement.
 *
 * `readPauses` is optional: it returns the pause switches (migration 022). While `weekly-xp` is paused no
 * weekly receipt is recorded; the database refuses one anyway, this just stops the noise. Nothing is lost:
 * receipts are recomputed from the ledger each round, so the quests are awarded once it is released. If the
 * switches cannot be read the round proceeds and the database guard still enforces the pause.
 */
export async function runSettlementRound({ provider, store, calendarCampaignId, settleVoting, readPauses, log }) {
	let voting = null;
	if (settleVoting) {
		try {
			voting = await settleVoting();
		} catch (error) {
			log?.({
				action: "voting_settlement_failed",
				error: error instanceof Error ? error.message.slice(0, 120) : "unknown",
			});
		}
	}
	const votingField = settleVoting ? { voting } : {};
	if (readPauses) {
		let pauses = null;
		try {
			pauses = await readPauses();
		} catch (error) {
			log?.({
				action: "pause_status_unavailable",
				error: error instanceof Error ? error.message.slice(0, 120) : "unknown",
			});
		}
		if (pauses?.["weekly-xp"]?.paused === true) {
			const summary = { action: "xp_settler_round", status: "weekly_xp_paused", ...votingField };
			log?.(summary);
			return summary;
		}
	}
	let qualification;
	try {
		qualification = await provider.read();
	} catch {
		const summary = { action: "xp_settler_round", status: "source_unavailable", ...votingField };
		log?.(summary);
		return summary;
	}
	const totals = { passports: 0, receiptsCreated: 0, failed: 0 };
	// A Passport is considered when it has a qualifying swap or a qualifying LP interval.
	const candidates = new Set(
		qualification.passports.filter((row) => row.qualifyingSwaps >= 1).map((row) => row.passportId),
	);
	for (const row of qualification.lp?.passports ?? [])
		if (row.pools.length >= 1) candidates.add(row.passportId);
	// A referrer can complete a referral quest without any activity of its own.
	for (const row of qualification.referrals ?? []) candidates.add(row.referrerPassportId);
	for (const passportId of [...candidates].sort()) {
		totals.passports++;
		try {
			const result = await store.reserve({
				campaignId: calendarCampaignId,
				passportId,
				qualification,
			});
			totals.receiptsCreated += result.created;
		} catch (error) {
			totals.failed++;
			log?.({
				action: "xp_settler_passport_failed",
				passport: passportId.slice(0, 8),
				error: error instanceof Error ? error.message.slice(0, 120) : "unknown",
			});
		}
	}
	const summary = {
		action: "xp_settler_round",
		status: "ok",
		computedThroughSlot: qualification.computedThroughSlot,
		...totals,
		...votingField,
	};
	log?.(summary);
	return summary;
}

