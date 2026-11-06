import type { PublicKey } from "@solana/web3.js";
import { useQuery } from "@tanstack/react-query";
import {
	getPoolFeePositionPDA,
	getPoolFeeVaultPDA,
	type RawPoolFeePosition,
	type RawPoolFeeVault,
	useVesolveProgram,
	vesolveAccount,
} from "./useVesolveProgram";

export type PoolFeeVaultPositionData = {
	vault: RawPoolFeeVault | null;
	position: RawPoolFeePosition | null;
};

/**
 * A pool's shared fee vault plus one LP position's registration in it, if
 * any. `position === null` means this position hasn't been registered yet
 * (registering doesn't require the vault to already exist — it's created
 * on first registration via init_if_needed).
 */
export const usePoolFeeVaultPosition = (
	poolAddress: PublicKey | undefined,
	positionMint: PublicKey | undefined,
) => {
	const program = useVesolveProgram();

	return useQuery({
		queryKey: [
			"pool-fee-vault-position",
			poolAddress?.toString(),
			positionMint?.toString(),
		],
		queryFn: async (): Promise<PoolFeeVaultPositionData> => {
			const [vaultAddress] = getPoolFeeVaultPDA(poolAddress as PublicKey);
			const [positionAddress] = getPoolFeePositionPDA(
				positionMint as PublicKey,
			);
			const [vault, position] = await Promise.all([
				vesolveAccount.poolFeeVault(program).fetchNullable(vaultAddress),
				vesolveAccount.poolFeePosition(program).fetchNullable(positionAddress),
			]);
			return { vault, position };
		},
		enabled: !!poolAddress && !!positionMint,
		refetchInterval: 15_000,
	});
};
