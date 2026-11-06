import { useQuery } from "@tanstack/react-query";
import {
	getExitConfigPDA,
	useVesolveProgram,
	vesolveAccount,
} from "@/hooks/useVesolveProgram";

export type ExitConfig = {
	/** Lamports per whole SOLV3, as published by an admin. */
	lamportsPerSolv3: bigint;
	updatedAt: number;
	updatedBy: string;
};

/**
 * The admin-published SOLV3 price the exit fee is charged against. Returns
 * null when no price has been set yet, in which case exit_lock rejects with
 * ExitPriceNotSet and the UI should say so rather than quoting a fee of zero.
 */
export const useExitConfig = () => {
	const program = useVesolveProgram();

	return useQuery({
		queryKey: ["vesolve-exit-config"],
		queryFn: async (): Promise<ExitConfig | null> => {
			const [exitConfigAddress] = getExitConfigPDA();
			const config = await vesolveAccount
				.exitConfig(program)
				.fetchNullable(exitConfigAddress);
			if (!config) return null;
			return {
				lamportsPerSolv3: BigInt(config.lamportsPerSolv3.toString()),
				updatedAt: Number(config.updatedAt.toString()),
				updatedBy: config.updatedBy.toString(),
			};
		},
		refetchInterval: 30_000,
		staleTime: 30_000,
	});
};

/**
 * Mirrors exit_lock's on-chain arithmetic exactly (u128 there, bigint here)
 * so the quoted fee is the amount the transaction will actually charge:
 * one division, rounded up, so no exit is free.
 */
export const calculateExitFeeLamports = (
	exitedBaseUnits: bigint,
	lamportsPerSolv3: bigint,
	feeBps: number,
): bigint => {
	const denominator = BigInt(1_000_000_000) * BigInt(10_000);
	return (
		(exitedBaseUnits * lamportsPerSolv3 * BigInt(feeBps) + denominator - BigInt(1)) /
		denominator
	);
};
