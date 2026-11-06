import { useLingui } from "@lingui/react";
import { AddressUtil } from "@solve3fi/common";
import type { TokenInfo } from "@solana/spl-token-registry";
import { PDAUtil, PoolUtil } from "@solve3fi/sdk";
import { useMutation } from "@tanstack/react-query";
import { notification } from "@/components/Notifications";
import { DEX_PROGRAM_ID, PROGRAM_CONFIG } from "@/configs/addresses";
import { assertGenesisTokenPairAllowed } from "@/configs/genesis";
import { useCluster } from "@/providers/ClusterProvider";
import { useClient } from "@/providers/DappProvider";
import { TICK_SPACINGS } from "@/stores/pool";
import { usePool } from "@/stores/pool/PoolProvider";

export type PoolQuoteIx = {
	tokenMintA?: TokenInfo | null;
	tokenMintB?: TokenInfo | null;
	tickCurrentIndex?: number;
	refetch?: () => void;
};

export const useCreatePool = () => {
	const { network } = useCluster();
	const { client, ctx } = useClient(DEX_PROGRAM_ID[network]);
	const feeTier = usePool((state) => state.feeTier);
	const { i18n } = useLingui();

	return useMutation({
		mutationKey: ["createPool"],
		mutationFn: async (data: PoolQuoteIx) => {
			const { tokenMintA, tokenMintB, tickCurrentIndex, refetch } = data;

			if (!tokenMintA || !tokenMintB || typeof tickCurrentIndex !== "number")
				throw new Error("Invalid data");
			assertGenesisTokenPairAllowed(tokenMintA.address, tokenMintB.address);

			const [tokenAddressA, tokenAddressB] = PoolUtil.orderMints(
				AddressUtil.toPubKey(tokenMintA.address),
				AddressUtil.toPubKey(tokenMintB.address),
			);

			const { tx, poolKey } = await client.createPool(
				PROGRAM_CONFIG[network],
				tokenAddressA,
				tokenAddressB,
				TICK_SPACINGS[feeTier],
				tickCurrentIndex,
				ctx.wallet.publicKey,
			);

			const signature = await tx.buildAndExecute({
				blockhashCommitment: "finalized",
			});
			const latest_blockhash = await ctx.connection.getLatestBlockhash();
			await ctx.connection.confirmTransaction(
				{ signature, ...latest_blockhash },
				"confirmed",
			);
			await refetch?.();
			return poolKey.toString();
		},
		onError: (error) => {
			console.error(error);
			notification.error({
				title: i18n._("Create Pool"),
				message:
					error instanceof Error && error.message
						? error.message
						: i18n._("Create pool failed!"),
			});
		},
		onSuccess: async () => {
			notification.success({
				title: i18n._("Create Pool"),
				message: i18n._("Pool created"),
			});
		},
	});
};
