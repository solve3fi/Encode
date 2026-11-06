import { useWallet } from "@solana/wallet-adapter-react";
import { type PublicKey, SystemProgram } from "@solana/web3.js";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import BN from "bn.js";
import { notification } from "@/components/Notifications";
import {
	getAllocationVoterPDA,
	getEpochPDA,
	getLockPDA,
	getProtocolPDA,
	getUserVotePDA,
	getVoteLockRecordPDA,
	useVesolveProgram,
	vesolveAccount,
} from "@/hooks/useVesolveProgram";

type Action =
	| { kind: "register"; veTokenId: number }
	| { kind: "unregister"; veTokenId: number }
	| {
			kind: "set";
			veTokenId: number;
			votes: { gauge: PublicKey; percent: number }[];
	  }
	| { kind: "apply"; veTokenId: number };

/**
 * Protocol allocation votes: register a lock, store its standing split (it is
 * applied every epoch by anyone through the apply step), clear it, or apply
 * it now. The split can be changed at any time; a change before the cutoff
 * replaces the current epoch's vote.
 */
export function useAllocationVotes() {
	const { publicKey } = useWallet();
	const program = useVesolveProgram();
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: async (action: Action) => {
			if (!publicKey) throw new Error("Connect a wallet.");
			const [protocol] = getProtocolPDA();
			const [lock] = getLockPDA(action.veTokenId);
			const [allocationVoter] = getAllocationVoterPDA(lock);
			if (action.kind === "register") {
				return program.methods
					.registerAllocationVoter(new BN(action.veTokenId))
					.accounts({
						admin: publicKey,
						protocol,
						lock,
						allocationVoter,
						systemProgram: SystemProgram.programId,
					})
					.rpc({ commitment: "confirmed" });
			}
			if (action.kind === "unregister") {
				return program.methods
					.unregisterAllocationVoter()
					.accounts({ admin: publicKey, protocol, allocationVoter })
					.rpc({ commitment: "confirmed" });
			}
			if (action.kind === "set") {
				return program.methods
					.setAllocationVotes(
						action.votes.map((vote) => ({
							gauge: vote.gauge,
							weight: new BN(vote.percent),
						})),
					)
					.accounts({ admin: publicKey, protocol, allocationVoter })
					.rpc({ commitment: "confirmed" });
			}
			const [state, protocolState] = await Promise.all([
				vesolveAccount.allocationVoter(program).fetch(allocationVoter),
				vesolveAccount.protocol(program).fetch(protocol),
			]);
			const epoch = protocolState.currentEpoch;
			return program.methods
				.applyAllocationVote(new BN(action.veTokenId))
				.accounts({
					payer: publicKey,
					protocol,
					epoch: getEpochPDA(BigInt(epoch.toString()))[0],
					lock,
					allocationVoter,
					userVote: getUserVotePDA(lock, BigInt(epoch.toString()))[0],
					voteLockRecord: getVoteLockRecordPDA(
						lock,
						BigInt(epoch.toString()),
					)[0],
					systemProgram: SystemProgram.programId,
				})
				.remainingAccounts(
					state.votes.map((vote) => ({
						pubkey: vote.gauge,
						isSigner: false,
						isWritable: false,
					})),
				)
				.rpc({ commitment: "confirmed" });
		},
		onSuccess: async (_sig, action) => {
			notification.success({
				title: "Allocation vote",
				message:
					action.kind === "apply"
						? "Standing vote applied for this epoch."
						: action.kind === "set"
							? "Standing vote saved. It applies every epoch."
							: action.kind === "register"
								? "Lock registered as a protocol allocation."
								: "Allocation unregistered.",
			});
			await queryClient.invalidateQueries({ queryKey: ["allocation-voter"] });
			await queryClient.invalidateQueries({
				queryKey: ["allocation-voter-registry"],
			});
		},
		onError: (error) =>
			notification.error({
				title: "Allocation vote unchanged",
				message:
					error instanceof Error ? error.message : "The transaction failed.",
			}),
	});
}
