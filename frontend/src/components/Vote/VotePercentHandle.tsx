import { useLingui } from "@lingui/react";
import { useCallback, useMemo } from "react";
import type { VoteInfo } from "@/stores/vote/hooks/useVotes";
import { useVote, useVoteActions } from "@/stores/vote/VoteProvider";
import classes from "./Vote.module.css";
import { useVoteCast } from "./VoteCast";

export type VotePercentHandleProps = {
	data: VoteInfo;
	disabled?: boolean;
};

const STEP = 10;

/** Per-gauge allocation: −/+ in 10% steps, a typeable percentage, and Max. */
export const VotePercentHandle: React.FC<VotePercentHandleProps> = ({
	data,
	disabled = false,
}) => {
	const { i18n } = useLingui();
	const { setVoteState } = useVoteActions();
	const voteState = useVote((state) => state.voteState);
	const voteCast = useVoteCast();
	const address = data.getAddress().toString();
	const pair = `${data.tokenAInfo.symbol}/${data.tokenBInfo.symbol}`;
	const value =
		voteState.find((vote) => vote.getAddress().toString() === address)
			?.votePercent ?? 0;
	const availablePercent = useMemo(() => {
		const allocatedToOtherPools = voteState.reduce(
			(total, vote) =>
				total +
				(vote.getAddress().toString() === address ? 0 : vote.votePercent),
			0,
		);
		return Math.floor(Math.max(0, 100 - allocatedToOtherPools));
	}, [address, voteState]);

	const commit = useCallback(
		(next: number) => {
			const votePercent = Number.isFinite(next)
				? Math.min(Math.max(Math.round(next), 0), availablePercent)
				: 0;
			setVoteState(
				Object.assign(Object.create(Object.getPrototypeOf(data)), data, {
					votePercent,
				}),
			);
		},
		[data, setVoteState, availablePercent],
	);

	return (
		<div className={classes.stepper}>
			<button
				type="button"
				className={classes.stepBtn}
				disabled={disabled || value <= 0}
				aria-label={i18n._("Decrease {pair} vote by 10%", { pair })}
				onClick={() => commit(value - STEP)}
			>
				−
			</button>
			<input
				className={classes.pct}
				inputMode="numeric"
				aria-label={i18n._("{pair} vote percentage", { pair })}
				value={value ? `${value}%` : "0%"}
				disabled={disabled}
				onChange={(event) => {
					const digits = event.currentTarget.value.replace(/[^0-9]/g, "");
					commit(digits === "" ? 0 : Number(digits));
				}}
			/>
			<button
				type="button"
				className={classes.stepBtn}
				disabled={
					disabled || availablePercent === 0 || value >= availablePercent
				}
				aria-label={i18n._("Increase {pair} vote by 10%", { pair })}
				onClick={() => commit(value + STEP)}
			>
				+
			</button>
			<div className={classes.maxCol}>
				{voteCast && value > 0 && (
					<button
						type="button"
						className={classes.rowVoteBtn}
						// Not connected: the click opens the wallet modal, as the panel button does.
						disabled={voteCast.connected && !voteCast.canCast}
						aria-label={i18n._("Cast vote for all selected gauges")}
						title={
							voteCast.votingClosed
								? i18n._("Voting closed")
								: i18n._("Submits your whole allocation, not just this gauge")
						}
						onClick={() => voteCast.cast("row")}
					>
						{voteCast.isPending ? "…" : i18n._("Vote")}
					</button>
				)}
				<button
					type="button"
					className={classes.maxBtn}
					disabled={disabled || availablePercent === 0}
					onClick={() => commit(availablePercent)}
				>
					{i18n._("Max")}
				</button>
			</div>
		</div>
	);
};
