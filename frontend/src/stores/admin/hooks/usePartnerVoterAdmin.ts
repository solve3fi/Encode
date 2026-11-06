import { useLingui } from "@lingui/react";
import { useWallet } from "@solana/wallet-adapter-react";
import { type PublicKey, SystemProgram } from "@solana/web3.js";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { notification } from "@/components/Notifications";
import {
	getPartnerVoterPDA,
	getProtocolPDA,
	useVesolveProgram,
} from "@/hooks/useVesolveProgram";

/** Admin: flag or unflag a voter wallet as a partner voter (0% auto-vote fee on the locks it votes). */
const usePartnerVoterAction = (
	key: string,
	title: string,
	send: (
		program: ReturnType<typeof useVesolveProgram>,
		admin: PublicKey,
		voter: PublicKey,
	) => Promise<string>,
) => {
	const { i18n } = useLingui();
	const { publicKey } = useWallet();
	const program = useVesolveProgram();
	const queryClient = useQueryClient();
	return useMutation({
		mutationKey: [key],
		mutationFn: async (voter: PublicKey) => {
			if (!publicKey) throw new Error(i18n._("Connect Wallet"));
			const signature = await send(program, publicKey, voter);
			await program.provider.connection.confirmTransaction(signature, "confirmed");
			return signature;
		},
		onSuccess: async () => {
			notification.success({ title, message: i18n._("Transaction confirmed") });
			await Promise.all([
				queryClient.invalidateQueries({ queryKey: ["vesolve-partner-voters"] }),
				queryClient.invalidateQueries({ queryKey: ["vesolve-auto-voters"] }),
			]);
		},
		onError: (error) => {
			console.error(error);
			notification.error({
				title,
				message: error instanceof Error ? error.message : String(error),
			});
		},
	});
};

export const useSetPartnerVoter = () => {
	const { i18n } = useLingui();
	return usePartnerVoterAction(
		"vesolve-set-partner-voter",
		i18n._("Partner voter"),
		(program, admin, voter) =>
			program.methods
				.setPartnerVoter(voter)
				.accounts({
					admin,
					protocol: getProtocolPDA()[0],
					partnerVoter: getPartnerVoterPDA(voter)[0],
					systemProgram: SystemProgram.programId,
				})
				.rpc(),
	);
};

export const useRemovePartnerVoter = () => {
	const { i18n } = useLingui();
	return usePartnerVoterAction(
		"vesolve-remove-partner-voter",
		i18n._("Partner voter"),
		(program, admin, voter) =>
			program.methods
				.removePartnerVoter()
				.accounts({
					admin,
					protocol: getProtocolPDA()[0],
					partnerVoter: getPartnerVoterPDA(voter)[0],
				})
				.rpc(),
	);
};
