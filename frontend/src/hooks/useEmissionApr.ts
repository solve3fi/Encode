import { poll } from "@/lib/poll";
import { DecimalUtil } from "@solve3fi/common";
import { getMint } from "@solana/spl-token";
import type { Solve } from "@solve3fi/sdk";
import { useQuery } from "@tanstack/react-query";
import BN from "bn.js";
import Decimal from "decimal.js";
import { useMemo } from "react";
import { DEX_PROGRAM_ID } from "@/configs/addresses";
import { gaugeEmissionAllocation } from "@/lib/gaugeEmissionAllocation";
import { nativeGaugeAddresses } from "@/lib/nativeGaugeAccounts";
import { useCluster } from "@/providers/ClusterProvider";
import { useAnchor } from "@/providers/DappProvider";
import { useUSDCPrice } from "./useUSDCPrice";
import {
	EMISSION_WEEK_SECONDS,
	getEpochEmissionPDA,
	getEpochPDA,
	getGaugePDA,
	getGaugeRewardPDA,
	getProtocolPDA,
	useVesolveProgram,
	vesolveAccount,
} from "./useVesolveProgram";

const SECONDS_PER_YEAR = 365 * 24 * 60 * 60;

/**
 * Emission APR for a pool's gauge: the annualized USD value of the vesolve
 * SOLV3 emissions its gauge is currently streaming, divided by the pool's
 * own TVL. NativeGauge supplies the current streaming rate, with a legacy
 * GaugeReward fallback before migration. The weekly column uses the actual
 * vote-weighted allocation, not a full-week extrapolation of a late-funded or
 * resumed stream. Voter trading-fee/bribe vaults are separate from LP emissions.
 */
export const useEmissionApr = (pool: Solve | null | undefined) => {
	const { network } = useCluster();
	const { connection } = useAnchor();
	const program = useVesolveProgram();

	const poolAddress = pool?.getAddress();

	const onChainQuery = useQuery({
		queryKey: ["emissionAprOnChain", network, poolAddress?.toString()],
		queryFn: async () => {
			if (!poolAddress) return null;

			const [protocolPda] = getProtocolPDA();
			const protocol = await vesolveAccount
				.protocol(program)
				.fetchNullable(protocolPda);
			if (!protocol) return null;

			const [gaugePda] = getGaugePDA(protocolPda, poolAddress);
			const gauge = await vesolveAccount.gauge(program).fetchNullable(gaugePda);
			if (!gauge?.isActive) return null;

			const [gaugeRewardPda] = getGaugeRewardPDA(gaugePda);
			const legacyReward = await vesolveAccount
				.gaugeReward(program)
				.fetchNullable(gaugeRewardPda);
			const addresses = nativeGaugeAddresses(
				program.programId,
				DEX_PROGRAM_ID[network],
				gaugePda,
				poolAddress,
			);
			const native = await vesolveAccount
				.nativeGauge(program)
				.fetchNullable(addresses.nativeGauge);
			const gaugeReward = native
				? {
						rewardRateX64: native.rateX64,
						periodFinish: native.periodFinish,
						rewardMint: protocol.tokenMint,
					}
				: legacyReward;
			if (!gaugeReward || gaugeReward.rewardRateX64.isZero()) return null;

			const nowSeconds = Math.floor(Date.now() / 1000);
			if (nowSeconds >= gaugeReward.periodFinish.toNumber()) return null;
			const fundedEpoch =
				native?.lastFundedEpoch ?? legacyReward?.lastFundedEpoch;
			if (!fundedEpoch?.eq(protocol.currentEpoch) || fundedEpoch.isZero())
				return null;
			const [emission, votes] = await Promise.all([
				vesolveAccount
					.epochEmission(program)
					.fetch(getEpochEmissionPDA(BigInt(fundedEpoch.toString()))[0]),
				vesolveAccount
					.epoch(program)
					.fetch(getEpochPDA(BigInt(fundedEpoch.toString()) - BigInt(1))[0]),
			]);
			const weight =
				votes.gaugeWeights.find((item) => item.gauge.equals(gaugePda))
					?.weight ?? new BN(0);
			const allocation = gaugeEmissionAllocation(
				emission.gaugeBudget,
				weight,
				votes.totalVotingPower,
			);

			const rewardMintInfo = await getMint(connection, gaugeReward.rewardMint);

			// reward_rate_x64 is tokens/sec in Q64.64 fixed point — multiply by a
			// week of seconds for the annualized APR rate, NOT the allocation.
			const weeklyAmountRaw = gaugeReward.rewardRateX64
				.mul(new BN(EMISSION_WEEK_SECONDS))
				.shrn(64);

			return {
				rewardMint: gaugeReward.rewardMint.toString(),
				allocation: DecimalUtil.fromBN(allocation, rewardMintInfo.decimals),
				rewardAmount: DecimalUtil.fromBN(
					weeklyAmountRaw,
					rewardMintInfo.decimals,
				),
				epochsPerYear: new Decimal(SECONDS_PER_YEAR).div(EMISSION_WEEK_SECONDS),
			};
		},
		enabled: !!poolAddress,
		staleTime: 30000,
		refetchInterval: poll(15_000),
	});

	const priceAddresses = useMemo(() => {
		const addresses: Record<string, number> = {};
		const tokenAInfo = pool?.getTokenAInfo();
		const tokenBInfo = pool?.getTokenBInfo();
		if (tokenAInfo) {
			addresses[tokenAInfo.mint.toString()] = DecimalUtil.fromBN(
				new BN(pool?.getTokenVaultAInfo().amount ?? 0),
				tokenAInfo.decimals,
			).toNumber();
		}
		if (tokenBInfo) {
			addresses[tokenBInfo.mint.toString()] = DecimalUtil.fromBN(
				new BN(pool?.getTokenVaultBInfo().amount ?? 0),
				tokenBInfo.decimals,
			).toNumber();
		}
		if (onChainQuery.data) {
			addresses[onChainQuery.data.rewardMint] =
				onChainQuery.data.rewardAmount.toNumber();
		}
		return addresses;
	}, [pool, onChainQuery.data]);

	const {
		breakdown,
		isLoading: pricesLoading,
		isComplete,
	} = useUSDCPrice(priceAddresses);

	return useMemo(() => {
		const onChain = onChainQuery.data;
		if (!onChain) {
			return {
				apr: new Decimal(0),
				emissionAmount: new Decimal(0),
				isLoading: onChainQuery.isLoading,
				dataUnavailable: !!onChainQuery.error,
				pricingComplete: onChainQuery.error ? false : undefined,
			};
		}

		const tokenAInfo = pool?.getTokenAInfo();
		const tokenBInfo = pool?.getTokenBInfo();
		const priceOf = (address?: string) =>
			new Decimal(
				breakdown.find((entry) => entry.address === address)?.price ?? 0,
			);
		const amountA = tokenAInfo
			? DecimalUtil.fromBN(
					new BN(pool?.getTokenVaultAInfo().amount ?? 0),
					tokenAInfo.decimals,
				)
			: new Decimal(0);
		const amountB = tokenBInfo
			? DecimalUtil.fromBN(
					new BN(pool?.getTokenVaultBInfo().amount ?? 0),
					tokenBInfo.decimals,
				)
			: new Decimal(0);
		const poolTvlUsd = priceOf(tokenAInfo?.mint.toString())
			.mul(amountA)
			.add(priceOf(tokenBInfo?.mint.toString()).mul(amountB));
		const rewardUsd = priceOf(onChain.rewardMint).mul(onChain.rewardAmount);
		if (!isComplete)
			return {
				apr: new Decimal(0),
				emissionAmount: onChain.allocation,
				isLoading: pricesLoading,
				pricingComplete: false,
			};

		if (poolTvlUsd.isZero()) {
			return {
				apr: new Decimal(0),
				emissionAmount: onChain.allocation,
				isLoading: pricesLoading,
			};
		}

		const annualRewardUsd = rewardUsd.mul(onChain.epochsPerYear);
		const apr = annualRewardUsd.div(poolTvlUsd).mul(100);

		return {
			apr,
			emissionAmount: onChain.allocation,
			isLoading: pricesLoading,
			pricingComplete: true,
		};
	}, [
		onChainQuery.data,
		onChainQuery.isLoading,
		onChainQuery.error,
		breakdown,
		pricesLoading,
		isComplete,
		pool,
	]);
};
