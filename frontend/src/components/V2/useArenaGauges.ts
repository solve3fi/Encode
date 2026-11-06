"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef } from "react";
import { notification } from "@/components/Notifications";
import { matchesPair, parseAllocParam } from "@/lib/command/plan";
import { gaugeVotingPower, votingPowerUnits, votingShare } from "@/lib/voteDisplay";
import { useAllTokens } from "@/hooks/useToken";
import { useCluster } from "@/providers/ClusterProvider";
import { usePools } from "@/stores/pool/hooks/usePools";
import { useUserVote } from "@/stores/vote/hooks/useUserVote";
import { useVote } from "@/stores/vote/hooks/useVote";
import { useVoteConfig } from "@/stores/vote/hooks/useVoteConfig";
import { useVoteEpochStats } from "@/stores/vote/hooks/useVoteEpochStats";
import { useVotes, type VoteInfo } from "@/stores/vote/hooks/useVotes";
import { useVoteActions, useVote as useVoteState } from "@/stores/vote/VoteProvider";
import { estimateGaugeSolv3 } from "../Vote/voteEstimate";

/** Tokens that make a pair "Core"; any other token makes it "Community". Symbols so devnet USDC counts as USDC. */
const CORE_SYMBOLS = new Set(["SOL", "USDC", "SOLV3", "devUSDC", "USDC.dev", "tUSDC"]);

export type ArenaRow = {
	info: VoteInfo;
	/** Pool identity is the pool address, never the pair. */
	addr: string;
	name: string;
	symA: string;
	symB: string;
	logoA?: string;
	logoB?: string;
	feePct: number;
	tvlUsd: number;
	votes: number;
	share: number;
	bribesUsd: number;
	feesUsd: number;
	rewardsUsd: number;
	estSolv3: number;
	core: boolean;
};

const usdValue = (
	breakdown: { address: string; price: number }[],
	mint: string,
	amount: { toString(): string },
	decimals: number,
) => {
	const price = breakdown.find((entry) => entry.address === mint)?.price ?? 0;
	if (price <= 0) return 0;
	return (Number(amount.toString()) / 10 ** decimals) * price;
};

/**
 * Gauge rows for the Arena. Same on-chain reads and pricing as the classic Vote page (VoteLists), same draft store
 * (VoteProvider) and the same hydration of the wallet's existing vote; only the presentation differs.
 */
export const useArenaGauges = () => {
	const { network } = useCluster();
	const tokenMap = useAllTokens();
	const { publicKey } = useWallet();

	const { data: voteConfig, error: configError } = useVoteConfig(network);
	const epoch = voteConfig?.epoch.toNumber() || 0;
	const { data: vote, isLoading: voteLoading, error: voteError, refetch: refreshVote } = useVote(network, epoch);
	const { data: votes, isLoading: votesLoading, error: votesError, refetch: refreshVotes } = useVotes(network, epoch);
	const { data: pools, isLoading: poolsLoading, error: poolsError } = usePools(
		network,
		votes?.map((item) => item.pool.toBase58()) || [],
	);
	const { breakdown } = useVoteEpochStats(network, epoch, votes, undefined);
	// breakdown is a fresh array every render; key on its content (same loop-avoidance as VoteLists).
	const priceKey = breakdown
		.map((entry) => `${entry.address}:${entry.price}`)
		.sort()
		.join(",");

	const resolveTokenDisplay = (mint: string) =>
		tokenMap[mint] ?? {
			chainId: 0,
			address: mint,
			symbol: `${mint.slice(0, 4)}…`,
			name: mint,
			decimals: 0,
		};

	const infos = useMemo(() => {
		return pools?.map((pool) => {
			const poolData = pool.getData();
			const gaugeVote = votes?.find((item) => item.pool.equals(pool.getAddress()));
			const tokenAInfo = resolveTokenDisplay(poolData.tokenMintA.toBase58());
			const tokenBInfo = resolveTokenDisplay(poolData.tokenMintB.toBase58());
			const bribesUsd = (gaugeVote?.bribesInfos ?? []).reduce(
				(sum, bribe) =>
					sum + usdValue(breakdown, bribe.mint.toBase58(), bribe.vaultInfo.amount, bribe.mintInfo.decimals),
				0,
			);
			const feesUsd =
				usdValue(breakdown, tokenAInfo.address, gaugeVote?.tradingFeesA ?? 0, tokenAInfo.decimals) +
				usdValue(breakdown, tokenBInfo.address, gaugeVote?.tradingFeesB ?? 0, tokenBInfo.decimals);
			const tvlUsd =
				usdValue(breakdown, tokenAInfo.address, pool.getTokenVaultAInfo().amount, tokenAInfo.decimals) +
				usdValue(breakdown, tokenBInfo.address, pool.getTokenVaultBInfo().amount, tokenBInfo.decimals);
			return Object.assign(Object.create(Object.getPrototypeOf(pool)), pool, {
				tokenAInfo,
				tokenBInfo,
				feeTier: { fee: poolData.feeRate },
				vote: gaugeVote,
				total: vote?.votes,
				votes: gaugeVotingPower(vote, gaugeVote?.gauge),
				bribesUsd,
				feesUsd,
				rewardsUsd: bribesUsd + feesUsd,
				tvlUsd,
			});
		}) as unknown as VoteInfo[];
		// biome-ignore lint/correctness/useExhaustiveDependencies: tokenMap/breakdown change identity every render; priceKey stands in for breakdown
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [pools, vote, votes, priceKey]);

	// ---- hydrate the draft with the wallet's existing on-chain vote (identical to VoteLists) ----
	const lockId = useVoteState((state) => state.lockId);
	const { data: userVote } = useUserVote(network, epoch, lockId);
	const voteState = useVoteState((state) => state.voteState);
	const { setVoteState, resetVoteState } = useVoteActions();
	const hydratedFor = useRef<string | null>(null);
	const lockJustChanged = useRef(false);
	// biome-ignore lint/correctness/useExhaustiveDependencies: runs only when the selected lock changes
	useEffect(() => {
		resetVoteState();
		hydratedFor.current = null;
		lockJustChanged.current = true;
	}, [lockId]);
	useEffect(() => {
		const key = `${network}:${publicKey?.toString() ?? ""}:${epoch}:${lockId}`;
		if (hydratedFor.current === key) return;
		if (!infos || userVote === undefined) return;
		hydratedFor.current = key;
		const draftIsStale = lockJustChanged.current;
		lockJustChanged.current = false;
		if ((voteState.length > 0 && !draftIsStale) || !userVote || userVote.votes.length === 0) return;
		const totalPower = userVote.totalVotingPower.toNumber();
		if (totalPower <= 0) return;
		for (const { gauge, weight } of userVote.votes) {
			const match = infos.find((item) => item.vote?.gauge.equals(gauge));
			if (match) {
				setVoteState(
					Object.assign(Object.create(Object.getPrototypeOf(match)), match, {
						votePercent: Math.round((weight.toNumber() * 100) / totalPower),
					}),
				);
			}
		}
	}, [infos, userVote, voteState.length, publicKey, network, epoch, lockId, setVoteState]);

	// ---- command-bar prefill: /v2?alloc=sol/usdc:50,solv3/usdc:50 (draft only; nothing is cast) ----
	const allocParam = useSearchParams().get("alloc");
	const prefilledFor = useRef<string | null>(null);
	useEffect(() => {
		if (!allocParam || !infos || infos.length === 0) return;
		if (publicKey && lockId && userVote === undefined) return;
		const key = `${allocParam}|${network}:${publicKey?.toString() ?? ""}:${lockId}`;
		if (prefilledFor.current === key) return;
		prefilledFor.current = key;
		const missing: string[] = [];
		resetVoteState();
		for (const { pool, percent } of parseAllocParam(allocParam)) {
			const match = infos.find((item) => matchesPair(pool, item.tokenAInfo.symbol, item.tokenBInfo.symbol));
			if (match) {
				setVoteState(
					Object.assign(Object.create(Object.getPrototypeOf(match)), match, { votePercent: percent }),
				);
			} else {
				missing.push(pool.toUpperCase());
			}
		}
		if (missing.length > 0) {
			notification.warning({
				title: "Some pools were not found",
				message: `No active gauge for ${missing.join(", ")}. Check the pool names.`,
			});
		}
	}, [allocParam, infos, publicKey, lockId, userVote, network, resetVoteState, setVoteState]);

	const rows: ArenaRow[] = useMemo(
		() =>
			(infos ?? []).map((info) => {
				const symA = info.tokenAInfo.symbol;
				const symB = info.tokenBInfo.symbol;
				const share = votingShare(info.votes, info.total);
				return {
					info,
					addr: info.getAddress().toString(),
					name: `${symA}/${symB}`,
					symA,
					symB,
					logoA: info.tokenAInfo.logoURI,
					logoB: info.tokenBInfo.logoURI,
					feePct: info.feeTier.fee / 10_000,
					tvlUsd: info.tvlUsd,
					votes: votingPowerUnits(info.votes),
					share,
					bribesUsd: info.bribesUsd,
					feesUsd: info.feesUsd,
					rewardsUsd: info.rewardsUsd,
					estSolv3: epoch > 0 ? estimateGaugeSolv3(epoch, share) : 0,
					core: CORE_SYMBOLS.has(symA) && CORE_SYMBOLS.has(symB),
				};
			}),
		[infos, epoch],
	);

	const isLoading = !voteConfig || votesLoading || poolsLoading || voteLoading;
	const error = configError || voteError || votesError || poolsError;
	return {
		rows,
		epoch,
		voteConfig,
		isLoading,
		error,
		retry: () => {
			refreshVote();
			refreshVotes();
		},
	};
};
