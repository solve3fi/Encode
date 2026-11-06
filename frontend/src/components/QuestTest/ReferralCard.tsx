"use client";

import { useCallback, useEffect, useState } from "react";
import { useQuestSession } from "./QuestSessionProvider";
import styles from "./ReferralCard.module.css";

type Overview = {
	code: string;
	ratePercent: number;
	maxReferrals: number;
	referredCount: number;
	bonusXp: number;
	referredBy: boolean;
	result?: string;
};
type ReferralClient = {
	referral: () => Promise<Overview>;
	redeemReferral: (code: string) => Promise<Overview>;
};

const MESSAGES: Record<string, string> = {
	OK: "Code accepted. Your friend earns a bonus on your weekly activity and voting XP from now on.",
	INVALID: "That code isn't valid.",
	SELF: "You can't use your own code.",
	ALREADY: "You have already used a referral code.",
	CYCLE: "That Passport already used your code.",
	FULL: "That code has reached its referral limit.",
};

/** Share your code, or enter a friend's. The server applies the bonus; nothing here awards XP. */
export function ReferralCard() {
	const { client, state } = useQuestSession();
	const [overview, setOverview] = useState<Overview | null>(null);
	const [failed, setFailed] = useState(false);
	const [code, setCode] = useState("");
	const [note, setNote] = useState<string | null>(null);
	const [copied, setCopied] = useState(false);
	const [busy, setBusy] = useState(false);
	const ready = (state as { status: string }).status === "READY";
	const api = client as unknown as ReferralClient | undefined;

	// A friend's link (...?ref=CODE) pre-fills the box once.
	useEffect(() => {
		const param = new URLSearchParams(window.location.search).get("ref");
		if (param && /^[A-Za-z0-9]{8}$/.test(param)) setCode(param.toUpperCase());
	}, []);

	const load = useCallback(async () => {
		if (!api) return;
		try {
			setOverview(await api.referral());
			setFailed(false);
		} catch {
			setOverview(null);
			setFailed(true);
		}
	}, [api]);

	useEffect(() => {
		if (ready) void load();
		else {
			setOverview(null);
			setFailed(false);
		}
	}, [ready, load]);

	if (!process.env.NEXT_PUBLIC_QUEST_TEST_CAMPAIGN) return null;

	const link = overview
		? `${typeof window === "undefined" ? "" : window.location.origin}/pass?ref=${overview.code}`
		: "";

	const copy = async () => {
		try {
			await navigator.clipboard.writeText(link);
			setCopied(true);
			setTimeout(() => setCopied(false), 2000);
		} catch {
			setNote("Copy failed. Select the link and copy it manually.");
		}
	};

	const redeem = async () => {
		if (!api || !/^[A-Za-z0-9]{8}$/.test(code)) {
			setNote(MESSAGES.INVALID);
			return;
		}
		setBusy(true);
		try {
			const value = await api.redeemReferral(code);
			setOverview(value);
			setNote(MESSAGES[value.result ?? "INVALID"] ?? MESSAGES.INVALID);
			if (value.result === "OK") setCode("");
		} catch {
			setNote("Referrals are unavailable right now. Try again soon.");
		} finally {
			setBusy(false);
		}
	};

	return (
		<section className={styles.card} aria-label="Referrals">
			<div className={styles.head}>
				<div>
					<span className={styles.eyebrow}>Referrals</span>
					<h3>Bring a friend, earn together</h3>
				</div>
				{overview && (
					<span className={styles.rate}>
						+{overview.ratePercent}% of activity and voting XP
					</span>
				)}
			</div>
			{!ready ? (
				<p className={styles.muted}>
					Connect and sign in to get your referral code.
				</p>
			) : failed ? (
				<p className={styles.muted}>Referrals are unavailable right now.</p>
			) : !overview ? (
				<p className={styles.muted}>Loading…</p>
			) : (
				<div className={styles.grid}>
					<div className={styles.block}>
						<span className={styles.label}>Your code</span>
						<strong className={styles.code}>{overview.code}</strong>
						<div className={styles.row}>
							<input
								className={styles.input}
								readOnly
								value={link}
								aria-label="Referral link"
							/>
							<button
								type="button"
								className={styles.cta}
								onClick={() => void copy()}
							>
								{copied ? "Copied" : "Copy link"}
							</button>
						</div>
						<p className={styles.muted}>
							Friends who use your code earn their XP as normal, and you earn{" "}
							{overview.ratePercent}% of their weekly activity and voting XP after they join. Up to{" "}
							{overview.maxReferrals} friends per code.
						</p>
						<dl className={styles.stats}>
							<div>
								<dt>Friends joined</dt>
								<dd>
									{overview.referredCount} / {overview.maxReferrals}
								</dd>
							</div>
							<div>
								<dt>Bonus XP earned</dt>
								<dd>{overview.bonusXp.toLocaleString()}</dd>
							</div>
						</dl>
					</div>
					<div className={styles.block}>
						<span className={styles.label}>Have a friend's code?</span>
						{overview.referredBy ? (
							<p className={styles.done}>You joined with a referral code.</p>
						) : (
							<>
								<div className={styles.row}>
									<input
										className={styles.input}
										value={code}
										maxLength={8}
										placeholder="8-character code"
										aria-label="Friend's referral code"
										onChange={(event) =>
											setCode(
												event.target.value
													.toUpperCase()
													.replace(/[^A-Z0-9]/g, ""),
											)
										}
									/>
									<button
										type="button"
										className={styles.cta}
										disabled={busy || code.length !== 8}
										onClick={() => void redeem()}
									>
										Use code
									</button>
								</div>
								<p className={styles.muted}>
									You can use one code, once. It doesn't change your own XP.
								</p>
							</>
						)}
						{note && (
							<p role="status" className={styles.note}>
								{note}
							</p>
						)}
					</div>
				</div>
			)}
		</section>
	);
}
