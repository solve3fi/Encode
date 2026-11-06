"use client";

import { useLingui } from "@lingui/react";
import { useWallet } from "@solana/wallet-adapter-react";
import type { PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { TransactionStatus } from "@/components/ProtocolStatus/TransactionStatus";
import { SUPPORT_MINT_TOKENS } from "@/configs/lock";
import {
	getGaugePDA,
	getProtocolPDA,
	useVesolveProgram,
	vesolveAccount,
} from "@/hooks/useVesolveProgram";
import { formatApr } from "@/lib/format";
import { mapTransactionError } from "@/lib/transactionErrors";
import { useCluster } from "@/providers/ClusterProvider";
import { useLockData } from "@/stores/lock/hooks/useLockData";
import { useLocks } from "@/stores/lock/hooks/useLocks";
import { ModalType } from "@/stores/modal";
import { useModalActions } from "@/stores/modal/ModalProvider";
import { useUserVote } from "@/stores/vote/hooks/useUserVote";
import { useVoteConfig } from "@/stores/vote/hooks/useVoteConfig";
import { useVoteEpochStats } from "@/stores/vote/hooks/useVoteEpochStats";
import { useVotes } from "@/stores/vote/hooks/useVotes";
import { useVote, useVoteActions } from "@/stores/vote/VoteProvider";
import { getExpolerUrl } from "@/utils/externalUrl";
import { TokenBalance } from "../Token/TokenBalance";
import { DraftRewardEstimate } from "./DraftRewardEstimate";
import classes from "./Vote.module.css";
import { useVoteCast } from "./VoteCast";

/**
 * "Your position": veNFT picker, veSOLV3 balance, claimable rewards, the
 * running allocation bar and the cast-vote action. Casting replaces the
 * wallet's whole allocation for the epoch, exactly as before.
 */
export const VotePosition: React.FC = () => {
	const { i18n } = useLingui();
	const { network } = useCluster();
	const { publicKey } = useWallet();
	const { setOpenModal } = useModalActions();

	const lockId = useVote((state) => state.lockId);
	const voteState = useVote((state) => state.voteState);
	const { setLockId, resetVoteState } = useVoteActions();
	const { data: locks, isLoading: locksLoading } = useLocks();
	const { data: lock } = useLockData(lockId);
	const { data: voteConfig } = useVoteConfig(network);
	const epoch = voteConfig?.epoch.toNumber() || 0;
	const { data: votes } = useVotes(network, epoch);
	const {
		emissionSharePercent,
		avgVotingApr,
		totalBribesUsd,
		totalTradingFeesUsd,
		totalRewardsUsd,
		isLoading,
		pricingComplete,
		bribesPricingComplete,
		feesPricingComplete,
		rewardsPricingComplete,
	} = useVoteEpochStats(network, epoch, votes, lock?.lockPower);

	useEffect(() => {
		if (!lockId && locks && locks.length > 0) {
			setLockId(locks[0].identifier.toNumber());
		}
	}, [lockId, locks, setLockId]);

	const totalVotes = useMemo(
		() => voteState.reduce((acc, { votePercent }) => acc + votePercent, 0),
		[voteState],
	);
	const remaining = Math.max(0, 100 - totalVotes);

	const hasVotedThisEpoch = Boolean(
		voteConfig &&
			lock &&
			!lock.lastVoteEpoch.isZero() &&
			lock.lastVoteEpoch.eq(voteConfig.epoch),
	);

	// One shared cast action, also used by the Vote button next to each gauge's Max.
	const voteCast = useVoteCast();
	const isPending = voteCast?.isPending ?? false;
	const isSuccess = voteCast?.isSuccess ?? false;
	const isError = voteCast?.isError ?? false;
	const data = voteCast?.data;
	const error = voteCast?.error;
	const transactionError = isError ? mapTransactionError(error) : undefined;
	const canCast = voteCast?.canCast ?? false;
	const votingClosed = voteCast?.votingClosed ?? false;

	// A cast started from a gauge row finishes far from this panel: bring the result into view.
	const finished = isSuccess || isError;
	useEffect(() => {
		if (finished && voteCast?.lastSource === "row") {
			document
				.getElementById("vote-status")
				?.scrollIntoView({ behavior: "smooth", block: "center" });
		}
	}, [finished, voteCast?.lastSource]);

	// "Revote": cast this lock's allocation from the previous epoch in one step. Percentages come from the stored
	// voting power of that vote; gauges that can no longer take votes (only active or pending-activation gauges can)
	// are skipped. One wallet approval sends it.
	const program = useVesolveProgram();
	const { data: previousVote } = useUserVote(
		network,
		Math.max(0, epoch - 1),
		lockId,
	);
	const [revoteNote, setRevoteNote] = useState<string | null>(null);
	const [revoteBusy, setRevoteBusy] = useState(false);
	const handleRevote = useCallback(async () => {
		if (
			!publicKey ||
			!voteCast?.canVote ||
			!previousVote ||
			previousVote.votes.length === 0
		)
			return;
		const totalPower = previousVote.totalVotingPower.toNumber();
		if (totalPower <= 0) return;
		setRevoteBusy(true);
		setRevoteNote(null);
		try {
			const [protocolAddress] = getProtocolPDA();
			const pools: PublicKey[] = [];
			const powers: number[] = [];
			let skipped = 0;
			for (const { gauge, weight } of previousVote.votes) {
				const account = await vesolveAccount
					.gauge(program)
					.fetchNullable(gauge);
				const acceptsVotes =
					account && (account.status === 1 || account.status === 2);
				if (
					!account ||
					!acceptsVotes ||
					!getGaugePDA(protocolAddress, account.poolAddress)[0].equals(gauge)
				) {
					skipped++;
					continue;
				}
				pools.push(account.poolAddress);
				powers.push(Math.round((weight.toNumber() * 100) / totalPower));
			}
			if (pools.length === 0) {
				setRevoteNote(
					i18n._("None of last epoch's gauges can take votes now."),
				);
				return;
			}
			// Rounding can push the total a point over 100: trim the largest share so the program accepts it.
			let overshoot = powers.reduce((sum, power) => sum + power, 0) - 100;
			if (overshoot > 0) {
				const largest = powers.indexOf(Math.max(...powers));
				powers[largest] -= overshoot;
				overshoot = 0;
			}
			const allocated = powers.reduce((sum, power) => sum + power, 0);
			const notes: string[] = [];
			if (skipped > 0) {
				notes.push(
					i18n._(
						"{skipped} of last epoch's gauges can no longer take votes and were left out.",
						{ skipped },
					),
				);
			}
			if (allocated < 100) {
				notes.push(
					i18n._(
						"This revote uses {used}% of your voting power; the other {left}% will not earn rewards this epoch.",
						{
							used: allocated,
							left: 100 - allocated,
						},
					),
				);
			}
			if (notes.length > 0) setRevoteNote(notes.join(" "));
			voteCast.castWith({ pools, powers }, "panel");
		} catch (error) {
			setRevoteNote(
				error instanceof Error
					? error.message
					: i18n._("Could not load last epoch's vote."),
			);
		} finally {
			setRevoteBusy(false);
		}
	}, [publicKey, voteCast, previousVote, program, i18n]);

	const veBalance = lock
		? lock.lockPower
				.div(
					new BN(
						10 ** SUPPORT_MINT_TOKENS[lock.lockTokenMint.toBase58()].decimals,
					),
				)
				.toNumber()
		: 0;

	const noLocks = !locksLoading && (!locks || locks.length === 0);

	return (
		<section className={classes.panel} aria-label={i18n._("Your position")}>
			<div className={classes.panelHead}>
				<div>
					<span className={classes.eyebrow}>{i18n._("Your position")}</span>
					<p className={classes.hint}>
						{i18n._(
							"Choose a veSOLV3 position, then allocate its voting power below.",
						)}
					</p>
				</div>
				<div className={classes.controls}>
					{!noLocks && (
						<>
							<label
								htmlFor="vote-lock"
								style={{ position: "absolute", left: -9999 }}
							>
								{i18n._("veNFT position")}
							</label>
							<select
								id="vote-lock"
								className={classes.select}
								value={lockId || ""}
								onChange={(event) =>
									setLockId(Number(event.currentTarget.value))
								}
							>
								{(locks ?? []).map((item) => (
									<option
										key={item.identifier.toNumber()}
										value={item.identifier.toNumber()}
									>
										{i18n._("Lock ID #")}
										{item.identifier.toNumber()}
									</option>
								))}
							</select>
						</>
					)}
					<Link href="/lock" className={classes.btnGhost}>
						{i18n._("Create lock")}
					</Link>
				</div>
			</div>

			<div className={classes.positionGrid}>
				<div className={classes.stat}>
					<span className={classes.statLabel}>{i18n._("Your veSOLV3")}</span>
					<span className={classes.statValue}>
						<TokenBalance value={veBalance} loading={false} />{" "}
						<small>veSOLV3</small>
					</span>
					<Link href="/lock" className={classes.statLink}>
						{i18n._("Lock SOLV3 for more")} →
					</Link>
				</div>
				<div className={classes.stat}>
					<span className={classes.statLabel}>
						{i18n._("Epoch rewards pot (all voters)")}
					</span>
					<span className={classes.statValue}>
						<TokenBalance
							value={
								rewardsPricingComplete ? totalRewardsUsd.toNumber() : undefined
							}
							loading={isLoading}
							prefix="$"
						/>
					</span>
					<Link href="/rewards?method=vote" className={classes.statLink}>
						{i18n._("Claim voting rewards")} →
					</Link>
				</div>
				<div className={`${classes.stat} ${classes.alloc}`}>
					<div className={classes.allocRow}>
						<span>
							{i18n._("Allocated")} {totalVotes}%
						</span>
						<span>
							{remaining}% {i18n._("left")}
						</span>
					</div>
					<div
						className={classes.bar}
						role="progressbar"
						aria-valuemin={0}
						aria-valuemax={100}
						aria-valuenow={Math.min(100, totalVotes)}
					>
						<div
							className={`${classes.barFill} ${totalVotes > 100 ? classes.barOver : ""}`}
							style={{ width: `${Math.min(100, totalVotes)}%` }}
						/>
					</div>
					<span className={classes.timing}>
						{i18n._("Epoch")} {epoch || "—"} ·{" "}
						{i18n._(
							"voting closes 5 minutes before the Thursday 00:00 UTC epoch boundary",
						)}
					</span>
				</div>
			</div>

			<div className={classes.positionGrid}>
				<div className={classes.stat}>
					<span className={classes.statLabel}>
						{i18n._("Emission/% of Vote")}
					</span>
					<span className={classes.statValue}>
						<TokenBalance
							value={emissionSharePercent.toNumber()}
							loading={false}
							decimalScale={2}
							suffix="%"
						/>
					</span>
				</div>
				<div className={classes.stat}>
					<span className={classes.statLabel}>
						{i18n._("Average gauge APR")}
					</span>
					<span className={classes.statValue} data-numeric="true">
						{isLoading || !pricingComplete
							? "—"
							: formatApr(avgVotingApr.toNumber(), { ceiling: 10_000 })}
					</span>
				</div>
				<div className={classes.stat}>
					<span className={classes.statLabel}>
						{i18n._("Total bribes")} · {i18n._("Trading fees")}
					</span>
					<span className={classes.statValue}>
						<TokenBalance
							value={
								bribesPricingComplete ? totalBribesUsd.toNumber() : undefined
							}
							loading={isLoading}
							prefix="$"
						/>{" "}
						<small>
							·{" "}
							<TokenBalance
								value={
									feesPricingComplete
										? totalTradingFeesUsd.toNumber()
										: undefined
								}
								loading={isLoading}
								prefix="$"
							/>
						</small>
					</span>
				</div>
			</div>

			{publicKey && lock && epoch > 0 && voteState.some((item) => item.vote && item.votePercent > 0) && <DraftRewardEstimate epoch={epoch} lockId={lockId} power={lock.lockPower} draft={voteState} />}

			{hasVotedThisEpoch && voteState.length > 0 && (
				<p className={classes.warn}>
					{i18n._(
						"This position has voted this epoch. Submitting replaces your wallet's current allocation entirely — any pool omitted here loses its allocation.",
					)}
				</p>
			)}
			<div id="vote-status" className={classes.status}>
				{isPending && (
					<TransactionStatus
						status="pending"
						title={i18n._("Approve and confirm your vote")}
						description={i18n._(
							"Keep this window open while the wallet request is submitted and confirmed on Solana.",
						)}
					/>
				)}
				{isSuccess && data && (
					<TransactionStatus
						status="success"
						title={i18n._("Vote recorded on-chain")}
						description={i18n._(
							"Your gauge allocation is now part of this epoch's vote.",
						)}
						signature={data}
						explorerUrl={getExpolerUrl(network, data, "tx")}
					/>
				)}
				{transactionError && (
					<TransactionStatus
						status="error"
						title={i18n._("Vote not submitted")}
						description={transactionError.message}
						details={transactionError.raw}
					/>
				)}
			</div>

			{totalVotes > 0 && totalVotes < 100 && (
				<p className={classes.warn} role="status">
					{i18n._(
						"You have allocated {used}% of this position's voting power. The other {left}% will not earn any rewards this epoch. Allocate all 100% to earn on your full veSOLV3.",
						{ used: totalVotes, left: remaining },
					)}
				</p>
			)}
			{revoteNote && (
				<p className={classes.hint} role="status">
					{revoteNote}
				</p>
			)}
			<div className={classes.castRow}>
				{!publicKey ? (
					<button
						type="button"
						className={classes.btnPrimary}
						onClick={() => setOpenModal(ModalType.WALLET)}
					>
						{i18n._("Connect wallet to vote")}
					</button>
				) : (
					<>
						{previousVote &&
							previousVote.votes.length > 0 &&
							voteCast?.canVote && (
								<button
									type="button"
									className={classes.btnGhost}
									disabled={votingClosed || isPending || revoteBusy}
									onClick={() => void handleRevote()}
									title={i18n._(
										"Vote last epoch's allocation again in one step",
									)}
								>
									{revoteBusy ? i18n._("Loading…") : i18n._("Revote")}
								</button>
							)}
						<button
							type="button"
							className={classes.btnPrimary}
							disabled={!canCast}
							onClick={() => voteCast?.cast("panel")}
						>
							{isPending
								? i18n._("Confirm in wallet…")
								: votingClosed
									? i18n._("Voting closed")
									: i18n._("Cast vote")}
						</button>
					</>
				)}
				{voteState.length > 0 && (
					<button
						type="button"
						className={classes.btnGhost}
						onClick={resetVoteState}
					>
						{i18n._("Reset")}
					</button>
				)}
			</div>
		</section>
	);
};
