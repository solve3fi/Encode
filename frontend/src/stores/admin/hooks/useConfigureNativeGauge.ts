import {
	ASSOCIATED_TOKEN_PROGRAM_ID,
	getAssociatedTokenAddressSync,
	TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { useWallet } from "@solana/wallet-adapter-react";
import {
	ComputeBudgetProgram,
	PublicKey,
	SystemProgram,
} from "@solana/web3.js";
import { IGNORE_CACHE } from "@solve3fi/sdk";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { notification } from "@/components/Notifications";
import { DEX_PROGRAM_ID, PROGRAM_CONFIG } from "@/configs/addresses";
import {
	getEpochPDA,
	getGaugePDA,
	getProtocolPDA,
	useVesolveProgram,
	vesolveAccount,
} from "@/hooks/useVesolveProgram";
import { configureNativeGaugeAccounts } from "@/lib/nativeGaugeAccounts";
import {
	buildOwedFeeSettlement,
	fetchTreasury,
	PROGRAM_UNGAUGED_PROTOCOL_FEE_RATE,
	sweepUngaugedPoolFeesAccounts,
} from "@/lib/sweepUngaugedFees";
import { useCluster } from "@/providers/ClusterProvider";
import { useClient } from "@/providers/DappProvider";

export function useConfigureNativeGauge() {
	const { publicKey } = useWallet();
	const { network } = useCluster();
	const { ctx } = useClient(DEX_PROGRAM_ID[network]);
	const program = useVesolveProgram();
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: async ({
			poolAddress,
			active,
		}: {
			poolAddress: string;
			active: boolean;
		}) => {
			if (!publicKey) throw new Error("Connect a wallet.");
			const pool = new PublicKey(poolAddress);
			const config = await ctx.fetcher.getConfig(
				PROGRAM_CONFIG[network],
				IGNORE_CACHE,
			);
			const [protocol] = getProtocolPDA();
			if (!config?.feeAuthority.equals(protocol) || !config.collectProtocolFeesAuthority.equals(protocol))
				throw new Error(
					"DEX gauge authority setup is incomplete. Contact the protocol admin.",
				);
			const [gauge] = getGaugePDA(protocol, pool);
			const [protocolState, gaugeState, poolData] = await Promise.all([
				vesolveAccount.protocol(program).fetch(protocol),
				vesolveAccount.gauge(program).fetch(gauge),
				ctx.fetcher.getPool(pool, IGNORE_CACHE),
			]);
			if (!poolData?.solvesConfig.equals(PROGRAM_CONFIG[network]))
				throw new Error("Pool does not belong to this DEX.");
			const before = [
				ComputeBudgetProgram.setComputeUnitLimit({ units: 700_000 }),
			];
			const owed =
				!poolData.protocolFeeOwedA.isZero() ||
				!poolData.protocolFeeOwedB.isZero();
			// Owed fees go to the Treasury in the same transaction: Treasury sweep at the
			// removed-gauge rate, DEX collect + forward at any other rate.
			const settleOwedToTreasury = async () => {
				if (poolData.protocolFeeRate !== PROGRAM_UNGAUGED_PROTOCOL_FEE_RATE)
					throw new Error("This pool has accrued fees under a legacy split. The protocol admin must review them before activation.");
				const treasury = await fetchTreasury(program);
				if (!treasury)
					throw new Error(
						"Set the Treasury first: this pool has uncollected protocol fees.",
					);
				if (
					poolData.protocolFeeRate !== PROGRAM_UNGAUGED_PROTOCOL_FEE_RATE &&
					!config.collectProtocolFeesAuthority.equals(publicKey)
				)
					throw new Error(
						"This pool's fee rate is not the removed-gauge rate, so its owed fees must be collected by the DEX collect-fees authority. Connect that wallet.",
					);
				before.push(
					...(await buildOwedFeeSettlement({
						pool: poolData,
						admin: publicKey,
						treasury,
						sweep: () =>
							program.methods
								.sweepUngaugedPoolFees()
								.accounts(
									sweepUngaugedPoolFeesAccounts({
										admin: publicKey,
										protocol,
										pool,
										solvesConfig: PROGRAM_CONFIG[network],
										tokenMintA: poolData.tokenMintA,
										tokenMintB: poolData.tokenMintB,
										tokenVaultA: poolData.tokenVaultA,
										tokenVaultB: poolData.tokenVaultB,
										treasury,
										dexProgramId: DEX_PROGRAM_ID[network],
									}),
								)
								.instruction(),
						collect: ({ a, b }) =>
							ctx.program.methods
								.collectProtocolFees()
								.accounts({
									solvesConfig: PROGRAM_CONFIG[network],
									solve: pool,
									collectProtocolFeesAuthority: publicKey,
									tokenVaultA: poolData.tokenVaultA,
									tokenVaultB: poolData.tokenVaultB,
									tokenDestinationA: a,
									tokenDestinationB: b,
									tokenProgram: TOKEN_PROGRAM_ID,
								})
								.instruction(),
					})),
				);
			};
			if (!active && gaugeState.isActive) {
				// Owed fees belong to this epoch's voters, routed into its vault. Once a
				// removal is due the gauge refuses new votes, so that vault usually has none
				// and routed fees could never be claimed (spec DEV-10). Without votes on the
				// gauge this epoch they go to the Treasury instead (spec 5.2).
				const epochState = await vesolveAccount
					.epoch(program)
					.fetchNullable(getEpochPDA(protocolState.currentEpoch.toNumber())[0]);
				const voted =
					epochState?.gaugeWeights.some(
						(entry) => entry.gauge.equals(gauge) && !entry.weight.isZero(),
					) ?? false;
				if (voted) {
					const vault = PublicKey.findProgramAddressSync(
						[
							Buffer.from("vault"),
							protocolState.currentEpoch.toArrayLike(Buffer, "le", 8),
							gauge.toBuffer(),
						],
						program.programId,
					)[0];
					before.push(
						await program.methods
							.routePoolFees(protocolState.currentEpoch)
							.accounts({
								caller: publicKey,
								admin: publicKey,
								epoch: getEpochPDA(protocolState.currentEpoch.toNumber())[0],
								protocol,
								gauge,
								pool,
								solvesConfig: PROGRAM_CONFIG[network],
								vault,
								tokenMintA: poolData.tokenMintA,
								tokenMintB: poolData.tokenMintB,
								tokenVaultA: poolData.tokenVaultA,
								tokenVaultB: poolData.tokenVaultB,
								vaultTokenAccountA: getAssociatedTokenAddressSync(
									poolData.tokenMintA,
									vault,
									true,
								),
								vaultTokenAccountB: getAssociatedTokenAddressSync(
									poolData.tokenMintB,
									vault,
									true,
								),
								solveProgram: DEX_PROGRAM_ID[network],
								tokenProgram: TOKEN_PROGRAM_ID,
								associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
								systemProgram: SystemProgram.programId,
							})
							.instruction(),
					);
				} else if (owed) {
					const treasury = await fetchTreasury(program);
					if (!treasury) throw new Error("Set the Treasury before settling this pool's fees.");
					before.push(await program.methods.settleRemovedGaugeFees().accounts({
						...sweepUngaugedPoolFeesAccounts({
							admin: publicKey, protocol, pool, solvesConfig: PROGRAM_CONFIG[network],
							tokenMintA: poolData.tokenMintA, tokenMintB: poolData.tokenMintB,
							tokenVaultA: poolData.tokenVaultA, tokenVaultB: poolData.tokenVaultB,
							treasury, dexProgramId: DEX_PROGRAM_ID[network],
						}), gauge, epoch: getEpochPDA(protocolState.currentEpoch.toNumber())[0],
					}).instruction());
				}
			}
			if (active && owed) {
				// Fees accrued before activation are settled first (the program refuses
				// activation while counters are nonzero).
				await settleOwedToTreasury();
			}
			return program.methods
				.configureNativeGauge(active)
				.accounts(
					configureNativeGaugeAccounts({
						admin: publicKey,
						protocol,
						gauge,
						pool,
						solvesConfig: PROGRAM_CONFIG[network],
						tokenMintA: poolData.tokenMintA,
						tokenMintB: poolData.tokenMintB,
						rewardMint: protocolState.tokenMint,
						programId: program.programId,
						dexProgramId: DEX_PROGRAM_ID[network],
					}),
				)
				.preInstructions(before)
				.rpc({ commitment: "confirmed" });
		},
		onSuccess: async () => {
			notification.success({
				title: "Gauge updated",
				message:
					"Gauge status, trading fees and LP emissions were updated together.",
			});
			await Promise.all(
				[
					"vesolve-all-gauges",
					"emissionAprOnChain",
					"allPools",
					"poolInfo",
					"pools",
					"bestTrade",
					"vesolve-native-gauges",
				].map((key) => queryClient.invalidateQueries({ queryKey: [key] })),
			);
		},
		onError: (error) =>
			notification.error({
				title: "Gauge unchanged",
				message:
					error instanceof Error
						? error.message
						: "The transaction failed. No partial change was applied.",
			}),
	});
}
