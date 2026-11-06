import { useQuery } from "@tanstack/react-query";
import { useVesolveProgram, vesolveAccount } from "./useVesolveProgram";

export type PartnerVoterEntry = { voter: string; addedAt: number };

/**
 * Voter wallets the Admin flagged as partner voters. Locks they vote pay no auto-vote fee, and they stay out of the
 * public auto-voter list: partners reach them through the partner page. Empty until the on-chain release that adds
 * the flag is live.
 */
export const usePartnerVoters = () => {
	const program = useVesolveProgram();
	return useQuery({
		queryKey: ["vesolve-partner-voters"],
		staleTime: 30_000,
		queryFn: async (): Promise<PartnerVoterEntry[]> => {
			const flagged = await vesolveAccount.partnerVoter(program).all();
			return flagged
				.map(({ account }) => ({
					voter: account.voter.toBase58(),
					addedAt: Number(account.addedAt.toString()),
				}))
				.sort((a, b) => a.addedAt - b.addedAt);
		},
	});
};
