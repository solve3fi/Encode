import { poll } from "@/lib/poll";
import { AddressUtil, DecimalUtil } from "@solve3fi/common";
import { getMint } from "@solana/spl-token";
import { useQuery } from "@tanstack/react-query";
import BN from "bn.js";
import Decimal from "decimal.js";
import { useMemo } from "react";
import { DEX_PROGRAM_ID } from "@/configs/addresses";
import { useUSDCPrice } from "@/hooks/useUSDCPrice";
import { usePools } from "@/hooks/usePools";
import {
	getEpochPDA,
	getGaugePDA,
	getProtocolPDA,
	getVaultPDA,
	useVesolveProgram,
	vesolveAccount,
} from "@/hooks/useVesolveProgram";
import type { ClusterNetwork } from "@/providers/ClusterProvider";
import { useClient } from "@/providers/DappProvider";
import type { VotePerGauge } from "./useVotes";

const SECONDS_PER_YEAR = 365 * 24 * 60 * 60;

/**
 * Protocol-wide stats for the current epoch, computed from real on-chain
 * state (gauges, epoch vote weights, vaults, bribes). Pricing completeness is
 * returned separately so the UI can distinguish a genuine zero from a token
 * that has no USDC route. Service-fee totals are intentionally not included
 * because this project has no historical fee indexer.
 */
export const useVoteEpochStats = (
	network: ClusterNetwork,
	epoch: number,
	votes: VotePerGauge[] | undefined,
	lockVotingPower: BN | undefined,
) => {
	const program = useVesolveProgram();
	const { client, ctx } = useClient(DEX_PROGRAM_ID[network]);
	const feePools = usePools(votes?.map((vote) => vote.pool.toString()));
	// Use the same funded-fee amounts as each gauge row. Reward totals must
	// not depend on the separate protocol/emission-APR query succeeding.
	const feeAmounts = useMemo(() => {
		const amounts: Record<string, number> = {};
		for (const vote of votes ?? []) {
			const pool = feePools.data?.find((pool) => pool.getAddress().equals(vote.pool));
			if (!pool) continue;
			for (const [mint, decimals, raw] of [[pool.getData().tokenMintA, pool.getTokenAInfo().decimals, vote.tradingFeesA], [pool.getData().tokenMintB, pool.getTokenBInfo().decimals, vote.tradingFeesB]] as const) {
				const address = mint.toString();
				amounts[address] = (amounts[address] ?? 0) + DecimalUtil.fromBN(raw, decimals).toNumber();
			}
		}
		return amounts;
	}, [votes, feePools.data]);

	const gaugeStatsQuery = useQuery({
		queryKey: [
			"voteEpochGaugeStats",
			network,
			epoch,
			votes?.map((v) => v.gauge.toString()).join(","),
		],
		queryFn: async () => {
			const [protocolPda] = getProtocolPDA();
			const [epochPda] = getEpochPDA(epoch);
			const [protocol, epochAccount] = await Promise.all([
				vesolveAccount.protocol(program).fetchNullable(protocolPda),
				vesolveAccount.epoch(program).fetchNullable(epochPda),
			]);
			if (!protocol || !epochAccount) return null;

			const rewardMintInfo = await getMint(
				ctx.connection,
				protocol.tokenMint,
			).catch(() => null);

			const perGauge = await Promise.all(
				(votes ?? []).map(async (v) => {
					const [gaugePda] = getGaugePDA(protocolPda, v.pool);
					const [vaultPda] = getVaultPDA(epoch, gaugePda);
					const [vault, pool] = await Promise.all([
						vesolveAccount.vault(program).fetchNullable(vaultPda),
						client.getPool(v.pool.toString()).catch(() => null),
					]);
					if (!pool) return null;

					const tokenAInfo = pool.getTokenAInfo();
					const tokenBInfo = pool.getTokenBInfo();
					return {
						feeAAmount: DecimalUtil.fromBN(vault?.poolRewardsA ?? new BN(0), tokenAInfo.decimals).toNumber(),
						feeBAmount: DecimalUtil.fromBN(vault?.poolRewardsB ?? new BN(0), tokenBInfo.decimals).toNumber(),
						tokenAMint: tokenAInfo.mint.toString(),
						tokenAAmount: DecimalUtil.fromBN(
							new BN(pool.getTokenVaultAInfo().amount ?? 0),
							tokenAInfo.decimals,
						).toNumber(),
						tokenBMint: tokenBInfo.mint.toString(),
						tokenBAmount: DecimalUtil.fromBN(
							new BN(pool.getTokenVaultBInfo().amount ?? 0),
							tokenBInfo.decimals,
						).toNumber(),
						rewardAmount:
							vault && rewardMintInfo
								? DecimalUtil.fromBN(
										vault.rewards,
										rewardMintInfo.decimals,
									).toNumber()
								: 0,
					};
				}),
			);

			const durationSeconds =
				epochAccount.endTime.sub(epochAccount.startTime).toNumber() ||
				protocol.epochResetTime.toNumber();

			return {
				rewardMint: protocol.tokenMint.toString(),
				totalVotingPower: epochAccount.totalVotingPower,
				epochsPerYear:
					durationSeconds > 0 ? SECONDS_PER_YEAR / durationSeconds : 0,
				perGauge: perGauge.filter((g): g is NonNullable<typeof g> => !!g),
			};
		},
		enabled: epoch > 0,
		refetchInterval: poll(15_000),
	});

	// One combined price lookup for every mint involved (pool TVL tokens,
	// the emission reward mint, and every bribe token) — priced individually
	// via `.price` (USD per 1 token) so per-gauge math below stays correct
	// even when the same mint shows up in more than one gauge or bribe.
	const priceAddresses = useMemo(() => {
		const addresses: Record<string, number> = { ...feeAmounts };
		const data = gaugeStatsQuery.data;
		if (data) {
			data.perGauge.forEach((g) => {
				if (g.tokenAAmount + g.feeAAmount > 0) addresses[g.tokenAMint] = g.tokenAAmount + g.feeAAmount;
				if (g.tokenBAmount + g.feeBAmount > 0) addresses[g.tokenBMint] = g.tokenBAmount + g.feeBAmount;
			});
			const totalReward = data.perGauge.reduce((s, g) => s + g.rewardAmount, 0);
			if (totalReward > 0) addresses[data.rewardMint] = totalReward;
		}
		(votes ?? []).forEach((v) => {
			v.bribesInfos.forEach((b) => {
				const amount = DecimalUtil.fromBN(
					b.vaultInfo.amount,
					b.mintInfo.decimals,
				).toNumber();
				if (amount <= 0) return;
				const key = AddressUtil.toPubKey(b.mint).toString();
				addresses[key] = (addresses[key] ?? 0) + amount;
			});
		});
		return addresses;
	}, [gaugeStatsQuery.data, votes, feeAmounts]);

	const {
		breakdown,
		isLoading: pricesLoading,
		isComplete: pricingComplete,
	} = useUSDCPrice(priceAddresses);

	return useMemo(() => {
		const priceOf = (address: string): Decimal => {
			const price = breakdown.find((entry) => entry.address === address)?.price;
			return price ? new Decimal(price) : new Decimal(0);
		};

		const data = gaugeStatsQuery.data;

		const hasPrice = (mint: string, amount: number) => amount === 0 || breakdown.some((entry) => entry.address === mint && entry.price > 0);
		const bribesPricingComplete = votes !== undefined && votes.every((vote) => vote.bribesInfos.every((bribe) =>
			hasPrice(bribe.mint.toString(), DecimalUtil.fromBN(bribe.vaultInfo.amount, bribe.mintInfo.decimals).toNumber()),
		));
		const feesPricingComplete = votes !== undefined && (votes.length === 0 || feePools.data?.length === votes.length) &&
			Object.entries(feeAmounts).every(([mint, amount]) => hasPrice(mint, amount));

		const totalBribesUsd = (votes ?? []).reduce((sum, v) => {
			return v.bribesInfos.reduce((inner, b) => {
				const amount = DecimalUtil.fromBN(
					b.vaultInfo.amount,
					b.mintInfo.decimals,
				);
				return inner.add(
					priceOf(AddressUtil.toPubKey(b.mint).toString()).mul(amount),
				);
			}, sum);
		}, new Decimal(0));

		const totalTradingFeesUsd = Object.entries(feeAmounts).reduce((sum, [mint, amount]) => sum.add(priceOf(mint).mul(amount)), new Decimal(0));
		let avgVotingApr = new Decimal(0);
		if (data && data.perGauge.length > 0) {
			const rewardPrice = priceOf(data.rewardMint);
			const gaugeAprs: Decimal[] = [];

			data.perGauge.forEach((g) => {
				const gaugeRewardUsd = rewardPrice.mul(g.rewardAmount);

				const tvlUsd = priceOf(g.tokenAMint)
					.mul(g.tokenAAmount)
					.add(priceOf(g.tokenBMint).mul(g.tokenBAmount));
				if (!tvlUsd.isZero() && g.rewardAmount > 0 && data.epochsPerYear > 0) {
					gaugeAprs.push(
						gaugeRewardUsd.div(tvlUsd).mul(100).mul(data.epochsPerYear),
					);
				}
			});

			if (gaugeAprs.length > 0) {
				avgVotingApr = gaugeAprs
					.reduce((sum, apr) => sum.add(apr), new Decimal(0))
					.div(gaugeAprs.length);
			}
		}

		return {
			breakdown,
			emissionSharePercent:
				data && lockVotingPower && !data.totalVotingPower.isZero()
					? new Decimal(lockVotingPower.toString())
							.div(new Decimal(data.totalVotingPower.toString()))
							.mul(100)
					: new Decimal(0),
			avgVotingApr,
			totalBribesUsd,
			totalTradingFeesUsd,
			totalRewardsUsd: totalBribesUsd.add(totalTradingFeesUsd),
			isLoading: gaugeStatsQuery.isLoading || pricesLoading,
			pricingComplete,
			bribesPricingComplete,
			feesPricingComplete,
			rewardsPricingComplete: bribesPricingComplete && feesPricingComplete,
		};
	}, [
		breakdown,
		gaugeStatsQuery.data,
		gaugeStatsQuery.isLoading,
		pricesLoading,
		pricingComplete,
		votes,
		lockVotingPower,
		feeAmounts,
		feePools.data,
	]);
};
