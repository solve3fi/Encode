import assert from "node:assert/strict";
import { PublicKey } from "@solana/web3.js";
import nacl from "tweetnacl";
import { fingerprintGenesisEvent } from "../../src/lib/genesis/eventFingerprint.ts";
import { compileQuestCalendar } from "./quest-calendar.mjs";
import { createQuestCalendarService } from "./quest-calendar-service.mjs";
import {
	createWeeklySwapProgressProvider,
	projectWeeklySwapProgress,
} from "./quest-weekly-swap-progress.mjs";
import { previewWeeklyXp } from "./quest-weekly-xp-preview.mjs";
import { rehearseWeeklyTestReceipts } from "./rehearse-quest-weekly-test-receipts.mjs";

/** Called only by the guarded disposable database rehearsal. No live inputs. */
export async function rehearseWeeklyProgress({
	connection,
	pool,
	calendarApi,
	receiptPool,
}) {
	const { auth, environment, context, plan } = calendarApi;
	const now = new Date(
		(await connection.query("SELECT clock_timestamp() AS now")).rows[0].now,
	).getTime();
	const set = compileQuestCalendar(plan).weeks.find(
		(w) => Date.parse(w.startsAt) <= now && now < Date.parse(w.endsAt),
	);
	const start = Date.parse(set.startsAt) / 1000,
		campaignId = "weekly-progress-source";
	const pair = nacl.sign.keyPair.fromSeed(Buffer.alloc(32, 221)),
		wallet = new PublicKey(pair.publicKey).toBase58(),
		passportId = "d1000000-0000-4000-8000-000000000001";
	await connection.query(
		"INSERT INTO quest.passports(passport_id) VALUES($1)",
		[passportId],
	);
	await connection.query(
		"INSERT INTO quest.wallet_bindings(wallet,passport_id) VALUES($1,$2)",
		[wallet, passportId],
	);
	await connection.query(
		"INSERT INTO quest.wallet_links(wallet,passport_id,linked_at,link_evidence_sha256) VALUES($1,$2,to_timestamp($3),repeat('d',64))",
		[wallet, passportId, start - 604800],
	);
	await connection.query(
		"INSERT INTO genesis.campaigns(id,cluster,starts_at,ends_at) VALUES($1,'devnet',to_timestamp($2),to_timestamp($3))",
		[campaignId, start - 604800, start + 1209600],
	);
	await connection.query(
		"INSERT INTO genesis.indexer_cursors(campaign_id,program_id,decoder_version,next_slot,reconciliation_start_slot) VALUES($1,'weekly-program','weekly-decoder',16,10)",
		[campaignId],
	);
	// Always past even if CI runs exactly at Thursday midnight; the prior-epoch
	// action proves lifetime history is not mistaken for weekly progress.
	const times = [
		start - 100,
		Math.min(start + 100, Math.floor(now / 1000)),
		Math.min(start + 200, Math.floor(now / 1000)),
		Math.min(start + 86401, Math.floor(now / 1000)),
		Math.min(start + 300, Math.floor(now / 1000)),
		Math.min(start + 400, Math.floor(now / 1000)),
	];
	for (const [i, blockTimeSeconds] of times.entries()) {
		const record = {
			campaignId,
			cluster: "devnet",
			signature: `weekly-fixture-${i}`,
			instructionIndex: 0,
			eventIndex: 0,
			eventKind: "swap",
			slot: 12,
			wallet,
			poolAddress: "fixture-pool",
			positionAddress: null,
			blockTimeSeconds,
			payload: { inputRaw: "100", instructionKind: "swap" },
		};
		const id = (
			await connection.query(
				`INSERT INTO genesis.chain_events(campaign_id,cluster,signature,instruction_index,event_index,event_kind,slot,block_time,wallet,pool_address,position_address,payload,event_sha256,decoder_version,verified_at) VALUES($1,'devnet',$2,0,0,'swap',12,to_timestamp($3),$4,$5,NULL,$6::jsonb,$7,'weekly-decoder',now()) RETURNING id`,
				[
					campaignId,
					record.signature,
					blockTimeSeconds,
					wallet,
					record.poolAddress,
					JSON.stringify(record.payload),
					fingerprintGenesisEvent(record).eventSha256,
				],
			)
		).rows[0].id;
		await connection.query(
			"INSERT INTO genesis.swap_valuations(campaign_id,chain_event_id,value_usd_cents,price_observed_at,valuation_source,valuation_version,price_evidence) VALUES($1,$2,600,to_timestamp($3),'weekly-price','weekly-price-v1','{\"fixture\":true}')",
			[campaignId, id, blockTimeSeconds],
		);
	}
	await connection.query(
		"UPDATE genesis.indexer_cursors SET reconciled_through_slot=15 WHERE campaign_id=$1",
		[campaignId],
	);
	const challenge = await auth.issueChallenge({ passportId, wallet }, context);
	const session = await auth.authenticate(
		{
			message: challenge.message,
			signature: Buffer.from(
				nacl.sign.detached(
					new TextEncoder().encode(challenge.message),
					pair.secretKey,
				),
			).toString("base64"),
		},
		context,
	);
	const authentication = {
		cookieHeader: session.cookie.split(";")[0],
		csrfToken: session.csrfToken,
	};
	const provider = createWeeklySwapProgressProvider({
		configuration: {
			pool,
			network: "DEVNET",
			campaignId,
			programId: "weekly-program",
			decoderVersion: "weekly-decoder",
			startSlot: 10,
			environment,
			policy: {
				fixtureKind: "SYNTHETIC_DEVNET",
				network: "DEVNET",
				revision: 1,
				minimumSwapUsdCents: "500",
				maximumPriceAgeSeconds: 10,
				valuationSource: "weekly-price",
				valuationVersion: "weekly-price-v1",
			},
		},
		resolveComputedThroughSlot: async () => 15,
	});
	const qualification = await provider.read(),
		capture = Date.parse(qualification.sourceContext.capturedAt);
	const progress = projectWeeklySwapProgress({
		set,
		passportId,
		qualification,
		sourcePins: provider.sourcePins,
		nowMs: capture,
	});
	assert.equal(progress.facts.metrics.qualifyingSwaps, 5);
	assert.equal(
		progress.facts.metrics.activeTradingDays,
		new Set(times.slice(1).map((t) => Math.floor(t / 86400))).size,
	);
	const xp = previewWeeklyXp({
		set,
		facts: progress.facts,
		nowMs: capture,
		priorPlans: [],
		policy: {
			fixtureKind: "SYNTHETIC_DEVNET",
			network: "DEVNET",
			revision: 1,
			perPassportEpochXp: "10000",
			perCampaignEpochXp: "100000",
			perCampaignYearXp: "1000000",
		},
	});
	assert.equal(xp.awardEligible, false);
	const service = createQuestCalendarService({
		auth,
		environment,
		weeklyProgressProvider: provider,
	});
	const view = await service.snapshot(
		{ campaignId: plan.campaignId },
		authentication,
		context,
	);
	assert.equal(view.progressSource.state, "HISTORICAL_QUALIFIED_PREFIX");
	assert.equal(
		view.weekly.quests.find((q) => q.metric === "qualifyingSwaps").progress,
        Math.min(5, view.weekly.quests.find((q) => q.metric === "qualifyingSwaps").target),
	);
	assert.ok(
		view.weekly.quests
			.filter(
				(q) => !["qualifyingSwaps", "activeTradingDays"].includes(q.metric),
			)
			.every((q) => q.progress === null),
	);
	assert.ok(!JSON.stringify(view).includes("sourceKeys"));
	const receiptStore = await rehearseWeeklyTestReceipts({
		connection,
		pool: receiptPool,
		environment,
		sourcePins: provider.sourcePins,
		qualification,
		passportId,
		plan,
		set,
	});
	// A late event invalidates the watermark; the next read must lose progress,
	// with no cached completion, fabricated zero, or leaked database failure.
	const late = {
		campaignId,
		cluster: "devnet",
		signature: "weekly-late-event",
		instructionIndex: 0,
		eventIndex: 0,
		eventKind: "swap",
		slot: 12,
		wallet,
		poolAddress: "fixture-pool",
		positionAddress: null,
		blockTimeSeconds: times[1],
		payload: { inputRaw: "100", instructionKind: "swap" },
	};
	await connection.query(
		`INSERT INTO genesis.chain_events(campaign_id,cluster,signature,instruction_index,event_index,event_kind,slot,block_time,wallet,pool_address,position_address,payload,event_sha256,decoder_version,verified_at) VALUES($1,'devnet',$2,0,0,'swap',12,to_timestamp($3),$4,$5,NULL,$6::jsonb,$7,'weekly-decoder',now())`,
		[
			campaignId,
			late.signature,
			late.blockTimeSeconds,
			wallet,
			late.poolAddress,
			JSON.stringify(late.payload),
			fingerprintGenesisEvent(late).eventSha256,
		],
	);
	const unavailable = await service.snapshot(
		{ campaignId: plan.campaignId },
		authentication,
		context,
	);
	assert.equal(unavailable.progressSource.state, "UNAVAILABLE");
	assert.ok(unavailable.weekly.quests.every((q) => q.progress === null));
	await assert.rejects(
		receiptStore.reserve({
			campaignId: plan.campaignId,
			passportId,
			qualification,
		}),
		/current source prefix differs/,
	);
	assert.ok(
		(await receiptStore.personalHistory(plan.campaignId, passportId)).length >
			0,
	);
	assert.equal(
		Number(
			(await connection.query("SELECT count(*) AS n FROM quest.xp_events"))
				.rows[0].n,
		),
		0,
	);
	console.log(
		"Weekly progress: real signatures, checked SQL prefix/valuations, epoch filtering, private view, synthetic XP planning, late-evidence invalidation and zero XP writes passed.",
	);
}
