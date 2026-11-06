import { BN } from "@coral-xyz/anchor";
import { useLingui } from "@lingui/react";
import { useWallet } from "@solana/wallet-adapter-react";
import { type PublicKey, SystemProgram } from "@solana/web3.js";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { notification } from "@/components/Notifications";
import {
	getAutoVoteDelegatePDA,
	getAutoVoteEnrollmentPDA,
	getAutoVoterPDA,
	getEpochPDA,
	getGaugePDA,
	getLockPDA,
	getProtocolPDA,
	getUserVotePDA,
	getVoteLockRecordPDA,
	useVesolveProgram,
	vesolveAccount,
} from "@/hooks/useVesolveProgram";

/**
 * Public auto-voter registry (DEV-12): anyone may register as an auto-voter, a lock owner picks one for an
 * enrolled lock, and that voter then votes it with delegated_vote. Locks that pick nobody stay with the Solve3
 * keeper. The 15% auto-vote fee goes to the protocol whichever voter is used. Hidden until the vesolve release that
 * adds these instructions is live.
 */
export const AUTO_VOTER_REGISTRY_ENABLED =
	process.env.NEXT_PUBLIC_AUTO_VOTER_REGISTRY === "true";

export type AutoVoterEntry = { authority: string; registeredAt: number };
export type AutoVoteChoice = { voter: string; setAt: number; current: boolean };
export type DelegatedLock = {
	lockAddress: PublicKey;
	veTokenId: number;
	votingPower: BN;
	owner: string;
};

// Byte offset of AutoVoteDelegate.voter: 8-byte discriminator + 32-byte lock.
const DELEGATE_VOTER_OFFSET = 40;

const errorMessage = (error: unknown, fallback: string) =>
	error instanceof Error && error.message ? error.message : fallback;

export const useAutoVoters = () => {
	const program = useVesolveProgram();
	return useQuery({
		queryKey: ["vesolve-auto-voters"],
		queryFn: async (): Promise<AutoVoterEntry[]> => {
			const [voters, partners] = await Promise.all([
				vesolveAccount.autoVoter(program).all(),
				// Partner voters are reached through the partner page, not offered to everyone.
				vesolveAccount.partnerVoter(program).all(),
			]);
			const hidden = new Set(partners.map(({ account }) => account.voter.toBase58()));
			return voters
				.filter(({ account }) => !hidden.has(account.authority.toBase58()))
				.map(({ account }) => ({
					authority: account.authority.toBase58(),
					registeredAt: Number(account.registeredAt.toString()),
				}))
				.sort((a, b) => a.registeredAt - b.registeredAt);
		},
		enabled: AUTO_VOTER_REGISTRY_ENABLED,
	});
};

/** The owner's current choice of voter for an enrolled lock, or null (Solve3 keeper). */
export const useAutoVoteChoice = (
	lockAddress: PublicKey | undefined,
	enrolledAt: number | undefined,
) => {
	const program = useVesolveProgram();
	return useQuery({
		queryKey: ["vesolve-auto-vote-choice", lockAddress?.toBase58(), enrolledAt],
		queryFn: async (): Promise<AutoVoteChoice | null> => {
			if (!lockAddress) return null;
			const [delegateAddress] = getAutoVoteDelegatePDA(lockAddress);
			const delegate = await vesolveAccount
				.autoVoteDelegate(program)
				.fetchNullable(delegateAddress);
			if (!delegate) return null;
			const setAt = Number(delegate.setAt.toString());
			return {
				voter: delegate.voter.toBase58(),
				setAt,
				current: enrolledAt !== undefined && setAt >= enrolledAt,
			};
		},
		enabled: AUTO_VOTER_REGISTRY_ENABLED && lockAddress !== undefined,
	});
};

/** Enrolled locks whose owners currently choose `voter`. */
export const useDelegatedLocks = (voter: PublicKey | null | undefined) => {
	const program = useVesolveProgram();
	return useQuery({
		queryKey: ["vesolve-delegated-locks", voter?.toBase58()],
		queryFn: async (): Promise<DelegatedLock[]> => {
			if (!voter) return [];
			const byVoter = {
				memcmp: { offset: DELEGATE_VOTER_OFFSET, bytes: voter.toBase58() },
			};
			const delegates = await vesolveAccount
				.autoVoteDelegate(program)
				.all([byVoter]);
			const locks = await Promise.all(
				delegates.map(async ({ account: delegate }) => {
					const [enrollmentAddress] = getAutoVoteEnrollmentPDA(delegate.lock);
					const [enrollment, lock] = await Promise.all([
						vesolveAccount
							.autoVoteEnrollment(program)
							.fetchNullable(enrollmentAddress),
						vesolveAccount.lock(program).fetchNullable(delegate.lock),
					]);
					// A choice left over from an earlier enrollment no longer counts (the program refuses it too).
					if (!enrollment || !lock || delegate.setAt.lt(enrollment.enrolledAt))
						return null;
					return {
						lockAddress: delegate.lock,
						veTokenId: Number(lock.veTokenId.toString()),
						votingPower: lock.votingPower,
						owner: lock.owner.toBase58(),
					};
				}),
			);
			return locks
				.filter((lock): lock is DelegatedLock => lock !== null)
				.sort((a, b) => a.veTokenId - b.veTokenId);
		},
		enabled: AUTO_VOTER_REGISTRY_ENABLED && Boolean(voter),
	});
};

const useRegistryMutation = <TInput>({
	key,
	title,
	success,
	failure,
	run,
	invalidate,
}: {
	key: string;
	title: string;
	success: string;
	failure: string;
	run: (input: TInput, owner: PublicKey) => Promise<string>;
	invalidate: (input: TInput) => unknown[][];
}) => {
	const { i18n } = useLingui();
	const { publicKey } = useWallet();
	const program = useVesolveProgram();
	const queryClient = useQueryClient();
	return useMutation({
		mutationKey: [key],
		mutationFn: async (input: TInput) => {
			if (!publicKey) throw new Error(i18n._("Connect Wallet"));
			const signature = await run(input, publicKey);
			await program.provider.connection.confirmTransaction(
				signature,
				"confirmed",
			);
			return { signature };
		},
		onSuccess: async (_, input) => {
			notification.success({ title: i18n._(title), message: i18n._(success) });
			await Promise.all(
				invalidate(input).map((queryKey) =>
					queryClient.invalidateQueries({ queryKey }),
				),
			);
		},
		onError: (error) => {
			console.error(error);
			notification.error({
				title: i18n._(title),
				message: errorMessage(error, i18n._(failure)),
			});
		},
	});
};

export const useRegisterAutoVoter = () => {
	const program = useVesolveProgram();
	return useRegistryMutation<void>({
		key: "vesolve-register-auto-voter",
		title: "Auto-voter",
		success: "Registered: lock owners can now choose you to vote their locks",
		failure: "Registration failed",
		run: (_, authority) =>
			program.methods
				.registerAutoVoter()
				.accounts({
					authority,
					autoVoter: getAutoVoterPDA(authority)[0],
					systemProgram: SystemProgram.programId,
				})
				.rpc(),
		invalidate: () => [["vesolve-auto-voters"]],
	});
};

export const useDeregisterAutoVoter = () => {
	const program = useVesolveProgram();
	return useRegistryMutation<void>({
		key: "vesolve-deregister-auto-voter",
		title: "Auto-voter",
		success: "Deregistered: you no longer vote any locks",
		failure: "Deregistration failed",
		run: (_, authority) =>
			program.methods
				.deregisterAutoVoter()
				.accounts({ authority, autoVoter: getAutoVoterPDA(authority)[0] })
				.rpc(),
		invalidate: () => [["vesolve-auto-voters"], ["vesolve-delegated-locks"]],
	});
};

export const useSetAutoVoter = () => {
	const program = useVesolveProgram();
	return useRegistryMutation<{ veTokenId: number; voter: PublicKey }>({
		key: "vesolve-set-auto-voter",
		title: "Public Auto-Vote",
		success: "Voter chosen for this lock",
		failure: "Could not choose this voter",
		run: ({ veTokenId, voter }, owner) => {
			const [lock] = getLockPDA(veTokenId);
			return program.methods
				.setAutoVoter(new BN(veTokenId))
				.accounts({
					owner,
					lock,
					enrollment: getAutoVoteEnrollmentPDA(lock)[0],
					autoVoter: getAutoVoterPDA(voter)[0],
					delegate: getAutoVoteDelegatePDA(lock)[0],
					systemProgram: SystemProgram.programId,
				})
				.rpc();
		},
		invalidate: ({ veTokenId }) => [
			["vesolve-auto-vote-choice", getLockPDA(veTokenId)[0].toBase58()],
			["vesolve-delegated-locks"],
		],
	});
};

export const useClearAutoVoter = () => {
	const program = useVesolveProgram();
	return useRegistryMutation<{ veTokenId: number }>({
		key: "vesolve-clear-auto-voter",
		title: "Public Auto-Vote",
		success: "Back to the Solve3 voter",
		failure: "Could not reset the voter",
		run: ({ veTokenId }, owner) => {
			const [lock] = getLockPDA(veTokenId);
			return program.methods
				.clearAutoVoter(new BN(veTokenId))
				.accounts({ owner, lock, delegate: getAutoVoteDelegatePDA(lock)[0] })
				.rpc();
		},
		invalidate: ({ veTokenId }) => [
			["vesolve-auto-vote-choice", getLockPDA(veTokenId)[0].toBase58()],
			["vesolve-delegated-locks"],
		],
	});
};

export type DelegatedVoteInput = {
	veTokenIds: number[];
	pools: PublicKey[];
	powers: number[];
};
export type DelegatedVoteResult = {
	voted: number[];
	failed: { veTokenId: number; error: string }[];
};

/** Votes every given lock (as its chosen auto-voter) with the same allocation; one transaction per lock. */
export const useDelegatedVote = () => {
	const { i18n } = useLingui();
	const { publicKey } = useWallet();
	const program = useVesolveProgram();
	const queryClient = useQueryClient();
	return useMutation({
		mutationKey: ["vesolve-delegated-vote"],
		mutationFn: async ({
			veTokenIds,
			pools,
			powers,
		}: DelegatedVoteInput): Promise<DelegatedVoteResult> => {
			if (!publicKey) throw new Error(i18n._("Connect Wallet"));
			if (veTokenIds.length === 0) throw new Error(i18n._("No locks to vote"));
			if (pools.length === 0 || pools.length !== powers.length)
				throw new Error(i18n._("Choose at least one gauge"));
			if (
				powers.some(
					(power) => !Number.isInteger(power) || power <= 0 || power > 100,
				) ||
				powers.reduce((total, power) => total + power, 0) > 100
			) {
				throw new Error(i18n._("Vote allocation cannot exceed 100%"));
			}

			const [protocolAddress] = getProtocolPDA();
			const protocol = await vesolveAccount
				.protocol(program)
				.fetch(protocolAddress);
			const currentEpoch = protocol.currentEpoch.toNumber();
			const [epochAddress] = getEpochPDA(currentEpoch);
			const gauges = pools.map((pool) => getGaugePDA(protocolAddress, pool)[0]);
			// VOTE_WEIGHT_PRECISION on-chain is 100 (a plain percentage).
			const gaugeVotes = gauges.map((gauge, i) => ({
				gauge,
				weight: new BN(powers[i]),
			}));
			const [autoVoter] = getAutoVoterPDA(publicKey);

			const result: DelegatedVoteResult = { voted: [], failed: [] };
			for (const veTokenId of veTokenIds) {
				const [lock] = getLockPDA(veTokenId);
				try {
					const signature = await program.methods
						.delegatedVote(new BN(veTokenId), gaugeVotes)
						.accounts({
							voter: publicKey,
							protocol: protocolAddress,
							epoch: epochAddress,
							lock,
							enrollment: getAutoVoteEnrollmentPDA(lock)[0],
							delegate: getAutoVoteDelegatePDA(lock)[0],
							autoVoter,
							userVote: getUserVotePDA(lock, currentEpoch)[0],
							voteLockRecord: getVoteLockRecordPDA(lock, currentEpoch)[0],
							systemProgram: SystemProgram.programId,
						})
						.remainingAccounts(
							gauges.map((pubkey) => ({
								pubkey,
								isWritable: false,
								isSigner: false,
							})),
						)
						.rpc();
					await program.provider.connection.confirmTransaction(
						signature,
						"confirmed",
					);
					result.voted.push(veTokenId);
				} catch (error) {
					result.failed.push({
						veTokenId,
						error: errorMessage(error, String(error)),
					});
				}
			}
			return result;
		},
		onSuccess: async (result) => {
			if (result.failed.length > 0) {
				notification.error({
					title: i18n._("Auto-vote"),
					message: i18n._("Voted {voted} locks; {failed} failed", {
						voted: result.voted.length,
						failed: result.failed.length,
					}),
				});
			} else {
				notification.success({
					title: i18n._("Auto-vote"),
					message: i18n._("Voted {voted} locks", {
						voted: result.voted.length,
					}),
				});
			}
			await Promise.all([
				queryClient.invalidateQueries({ queryKey: ["vesolve-epoch"] }),
				queryClient.invalidateQueries({ queryKey: ["vesolve-votes"] }),
			]);
		},
		onError: (error) => {
			console.error(error);
			notification.error({
				title: i18n._("Auto-vote"),
				message: errorMessage(error, i18n._("Voting failed")),
			});
		},
	});
};
