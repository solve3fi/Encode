"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import type { PublicKey } from "@solana/web3.js";
import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useState,
} from "react";
import { useCluster } from "@/providers/ClusterProvider";
import { useLockData } from "@/stores/lock/hooks/useLockData";
import { ModalType } from "@/stores/modal";
import { useModalActions } from "@/stores/modal/ModalProvider";
import { useCreateVote } from "@/stores/vote/hooks/useCreateVote";
import { useVoteConfig } from "@/stores/vote/hooks/useVoteConfig";
import { useVote } from "@/stores/vote/VoteProvider";
import { getEpochClockState } from "./epochClock";

/** Where a cast was started: the "Your position" panel or a gauge row's Vote button. */
export type CastSource = "panel" | "row";

type VoteCastValue = {
	connected: boolean;
	totalVotes: number;
	canVote: boolean;
	votingClosed: boolean;
	/** Cast is allowed right now (an allocation exists, within 100%, owner connected, voting open, not in flight). */
	canCast: boolean;
	isPending: boolean;
	isSuccess: boolean;
	isError: boolean;
	data: string | undefined;
	error: unknown;
	lastSource: CastSource | null;
	/** Submits the wallet's whole allocation, or opens the wallet modal when not connected. */
	cast: (source: CastSource) => void;
	/** Submits a specific allocation (used by Revote) through the same transaction and status. */
	castWith: (
		input: { pools: PublicKey[]; powers: number[] },
		source: CastSource,
	) => void;
};

const VoteCastContext = createContext<VoteCastValue | null>(null);

/**
 * One shared cast-vote action for the Vote page, so the panel's "Cast vote" button and the per-gauge
 * "Vote" button drive the same transaction and the same status messages. Casting replaces the
 * wallet's whole allocation for the epoch, exactly as before.
 */
export const VoteCastProvider: React.FC<{ children: React.ReactNode }> = ({
	children,
}) => {
	const { network } = useCluster();
	const { publicKey } = useWallet();
	const { setOpenModal } = useModalActions();
	const lockId = useVote((state) => state.lockId);
	const voteState = useVote((state) => state.voteState);
	const { data: lock } = useLockData(lockId);
	const { data: voteConfig } = useVoteConfig(network);
	const { mutate, isPending, isSuccess, isError, data, error, reset } =
		useCreateVote();
	const [lastSource, setLastSource] = useState<CastSource | null>(null);

	// A new lock starts a clean cast (same behavior the panel had on its own).
	// biome-ignore lint/correctness/useExhaustiveDependencies: lockId is the trigger, not a value read inside
	useEffect(() => {
		reset();
	}, [lockId, reset]);

	const totalVotes = useMemo(
		() => voteState.reduce((acc, { votePercent }) => acc + votePercent, 0),
		[voteState],
	);
	const canVote = Boolean(
		publicKey && lock && voteConfig && lock.owner.equals(publicKey),
	);
	const votingClosed = Boolean(
		voteConfig &&
			getEpochClockState(
				voteConfig.nextEpochTime,
				Math.floor(
					voteConfig.chainTime +
						(Date.now() - voteConfig.localTimeAtFetch) / 1_000,
				),
			) !== "open",
	);
	const canCast =
		totalVotes > 0 &&
		totalVotes <= 100 &&
		canVote &&
		!votingClosed &&
		!isPending;

	const cast = useCallback(
		(source: CastSource) => {
			if (!publicKey) {
				setOpenModal(ModalType.WALLET);
				return;
			}
			if (!canVote) return;
			setLastSource(source);
			reset();
			mutate({
				lockId,
				authority: publicKey,
				pools: voteState.map((item) => item.getAddress()),
				powers: voteState.map((item) => item.votePercent),
			});
		},
		[publicKey, canVote, lockId, mutate, reset, voteState, setOpenModal],
	);

	const castWith = useCallback(
		(input: { pools: PublicKey[]; powers: number[] }, source: CastSource) => {
			if (!publicKey) {
				setOpenModal(ModalType.WALLET);
				return;
			}
			if (!canVote) return;
			setLastSource(source);
			reset();
			mutate({
				lockId,
				authority: publicKey,
				pools: input.pools,
				powers: input.powers,
			});
		},
		[publicKey, canVote, lockId, mutate, reset, setOpenModal],
	);

	const value = useMemo<VoteCastValue>(
		() => ({
			connected: Boolean(publicKey),
			totalVotes,
			canVote,
			votingClosed,
			canCast,
			isPending,
			isSuccess,
			isError,
			data,
			error,
			lastSource,
			cast,
			castWith,
		}),
		[
			publicKey,
			totalVotes,
			canVote,
			votingClosed,
			canCast,
			isPending,
			isSuccess,
			isError,
			data,
			error,
			lastSource,
			cast,
			castWith,
		],
	);

	return (
		<VoteCastContext.Provider value={value}>
			{children}
		</VoteCastContext.Provider>
	);
};

/** Null outside the Vote page, so components can render without a cast button there. */
export const useVoteCast = (): VoteCastValue | null =>
	useContext(VoteCastContext);
