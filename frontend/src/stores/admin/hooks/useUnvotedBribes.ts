import type { BN } from "@coral-xyz/anchor";
import {
	ASSOCIATED_TOKEN_PROGRAM_ID,
	getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { useWallet } from "@solana/wallet-adapter-react";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { notification } from "@/components/Notifications";
import {
	getEpochPDA,
	getProtocolPDA,
	getVaultPDA,
	useVesolveProgram,
	VESOLVE_PROGRAM_ID,
	vesolveAccount,
} from "@/hooks/useVesolveProgram";
import { useCluster } from "@/providers/ClusterProvider";

/** How many epochs back the recovery list looks (the current one included). */
export const BRIBE_LOOKBACK_EPOCHS = 6;

export type BribeLedgerRow = {
	epoch: number;
	gauge: PublicKey;
	mint: PublicKey;
	amount: BN;
	/** Anyone voted for the gauge in that epoch, so the bribe belongs to its voters. */
	hasVotes: boolean;
	/** The epoch has ended; votes are final and an unvoted bribe can move. */
	ended: boolean;
};

/**
 * Every recorded bribe over the last few epochs, with whether it can still be recovered. A bribe cannot be
 * refunded to the wallet that made it (programs/vesolve/src/instructions/sweep_bribe.rs): once an epoch ends,
 * a bribe on a gauge nobody voted for goes to the Treasury; a bribe on a voted gauge pays its voters.
 */
export const useBribeLedger = () => {
	const program = useVesolveProgram();
	const { network } = useCluster();
	return useQuery({
		queryKey: ["admin-bribe-ledger", network],
		queryFn: async (): Promise<BribeLedgerRow[]> => {
			const protocol = await vesolveAccount
				.protocol(program)
				.fetch(getProtocolPDA()[0]);
			const current = protocol.currentEpoch.toNumber();
			const epochs: number[] = [];
			for (
				let e = current;
				e >= 0 && epochs.length < BRIBE_LOOKBACK_EPOCHS;
				e--
			)
				epochs.push(e);
			const accounts = await vesolveAccount
				.epoch(program)
				.fetchMultiple(epochs.map((e) => getEpochPDA(e)[0]));
			const now = Math.floor(Date.now() / 1000);
			const rows: BribeLedgerRow[] = [];
			accounts.forEach((epoch, index) => {
				if (!epoch) return;
				for (const bribe of epoch.bribes) {
					if (bribe.amount.isZero()) continue;
					rows.push({
						epoch: epochs[index],
						gauge: bribe.gauge,
						mint: bribe.tokenMint,
						amount: bribe.amount,
						hasVotes: epoch.gaugeWeights.some(
							(w) => w.gauge.equals(bribe.gauge) && !w.weight.isZero(),
						),
						ended: now >= epoch.endTime.toNumber(),
					});
				}
			});
			return rows;
		},
		refetchInterval: 30_000,
	});
};

// Same seed useProtocolControls reads (programs/vesolve admin_config).
const ADMIN_CONFIG_PDA = PublicKey.findProgramAddressSync(
	[Buffer.from("admin_config")],
	VESOLVE_PROGRAM_ID,
)[0];

export type SweepBribeInput = {
	epoch: number;
	gauge: PublicKey;
	mint: PublicKey;
	treasury: PublicKey;
};

/** Permissionless sweep of an unvoted bribe to the configured Treasury (`sweep_unvoted_bribe`). */
export const useSweepUnvotedBribe = () => {
	const { publicKey } = useWallet();
	const program = useVesolveProgram();
	const queryClient = useQueryClient();
	return useMutation({
		mutationKey: ["vesolve-sweep-unvoted-bribe"],
		mutationFn: async ({ epoch, gauge, mint, treasury }: SweepBribeInput) => {
			if (!publicKey) throw new Error("Connect the protocol Admin wallet.");
			const connection = program.provider.connection;
			const mintInfo = await connection.getAccountInfo(mint);
			if (!mintInfo) throw new Error("Bribe token not found.");
			const tokenProgram = mintInfo.owner;
			const [vault] = getVaultPDA(epoch, gauge);
			const signature = await program.methods
				.sweepUnvotedBribe()
				.accountsPartial({
					caller: publicKey,
					protocol: getProtocolPDA()[0],
					gauge,
					epoch: getEpochPDA(epoch)[0],
					vault,
					tokenMint: mint,
					bribeVaultTokenAccount: getAssociatedTokenAddressSync(
						mint,
						vault,
						true,
						tokenProgram,
					),
					treasury,
					treasuryTokenAccount: getAssociatedTokenAddressSync(
						mint,
						treasury,
						true,
						tokenProgram,
					),
					adminConfig: ADMIN_CONFIG_PDA,
					systemProgram: SystemProgram.programId,
					tokenProgram,
					associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
				} as never)
				.rpc({ commitment: "confirmed" });
			return signature;
		},
		onSuccess: async () => {
			notification.success({
				title: "Bribe sent to Treasury",
				message: "The unvoted bribe was swept to the Treasury wallet.",
			});
			await queryClient.invalidateQueries({ queryKey: ["admin-bribe-ledger"] });
		},
		onError: (error) => {
			console.error(error);
			notification.error({
				title: "Bribe recovery",
				message: error instanceof Error ? error.message : String(error),
			});
		},
	});
};
