import { useLingui } from "@lingui/react";
import {
	createAssociatedTokenAccountIdempotentInstruction,
	createTransferCheckedInstruction,
	getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { Transaction } from "@solana/web3.js";
import { type Address, AddressUtil } from "@solve3fi/common";
import type { Position } from "@solve3fi/sdk";
import { useMutation } from "@tanstack/react-query";
import { notification } from "@/components/Notifications";
import { DEX_PROGRAM_ID } from "@/configs/addresses";
import { useCluster } from "@/providers/ClusterProvider";
import { useClient } from "@/providers/DappProvider";

export type TransferPositionQuote = {
	position: Position;
	receiver: Address;
	refetch?: () => void;
};

export const useTransferPosition = () => {
	const { i18n } = useLingui();
	const { network } = useCluster();
	const { ctx } = useClient(DEX_PROGRAM_ID[network]);

	return useMutation({
		mutationKey: ["transferPosition"],
		mutationFn: async (data: TransferPositionQuote) => {
			const { position, receiver, refetch } = data;

			if (!position || !receiver) throw new Error("Position not found");

			// The position NFT is its own mint (not the position account), owned by the classic token program or
			// Token-2022 depending on how the position was opened; both ATAs must be derived under that program.
			const positionMint = position.getData().positionMint;
			const mintInfo = await ctx.connection.getAccountInfo(positionMint);
			if (!mintInfo) throw new Error("Position mint not found");
			const tokenProgram = mintInfo.owner;
			const owner = AddressUtil.toPubKey(receiver);

			const senderATA = getAssociatedTokenAddressSync(
				positionMint,
				ctx.wallet.publicKey,
				false,
				tokenProgram,
			);
			const receiverATA = getAssociatedTokenAddressSync(
				positionMint,
				owner,
				true,
				tokenProgram,
			);

			const ixs = [];
			if (!(await ctx.connection.getAccountInfo(receiverATA))) {
				ixs.push(
					createAssociatedTokenAccountIdempotentInstruction(
						ctx.wallet.publicKey,
						receiverATA,
						owner,
						positionMint,
						tokenProgram,
					),
				);
			}

			ixs.push(
				createTransferCheckedInstruction(
					senderATA,
					positionMint,
					receiverATA,
					ctx.wallet.publicKey,
					1,
					0,
					[],
					tokenProgram,
				),
			);
			const tx = new Transaction().add(...ixs);
			await ctx.provider.sendAndConfirm(tx);

			await refetch?.();
		},
		onError: (error) => {
			console.error(error);
			notification.error({
				title: i18n._("Transfer Liquidity"),
				message: i18n._("Transfer liquidity failed!"),
			});
		},
		onSuccess: async () => {
			notification.success({
				title: i18n._("Transfer Liquidity"),
				message: i18n._("Transfer liquidity successfully!"),
			});
		},
	});
};
