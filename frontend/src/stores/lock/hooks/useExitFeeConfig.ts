import { useQuery } from "@tanstack/react-query";
import { EXIT_FEE_BPS } from "@/configs/lockExit";
import {
	getExitFeeConfigPDA,
	useVesolveProgram,
	vesolveAccount,
} from "@/hooks/useVesolveProgram";

export type ExitFeeConfig = {
	/** Fee before any pending change applies, in basis points. */
	feeBps: number;
	/** Scheduled fee; applies from `pendingEpoch`. Only meaningful when pendingEpoch > 0. */
	pendingBps: number;
	pendingEpoch: number;
};

/** The default fee before Admin has ever set one. */
const DEFAULT_CONFIG: ExitFeeConfig = {
	feeBps: EXIT_FEE_BPS,
	pendingBps: 0,
	pendingEpoch: 0,
};

/**
 * The exit fee settings. When the account does not exist the initial
 * EXIT_FEE_BPS applies, exactly as on-chain.
 */
export const useExitFeeConfig = () => {
	const program = useVesolveProgram();

	return useQuery({
		queryKey: ["vesolve-exit-fee-config"],
		queryFn: async (): Promise<ExitFeeConfig> => {
			const [address] = getExitFeeConfigPDA();
			const config = await vesolveAccount
				.exitFeeConfig(program)
				.fetchNullable(address);
			if (!config) return DEFAULT_CONFIG;
			return {
				feeBps: Number(config.feeBps.toString()),
				pendingBps: Number(config.pendingBps.toString()),
				pendingEpoch: Number(config.pendingEpoch.toString()),
			};
		},
		refetchInterval: 30_000,
		staleTime: 30_000,
	});
};

/** Mirrors ExitFeeConfig::effective_bps: the fee in force at `currentEpoch`. */
export const effectiveExitFeeBps = (
	config: ExitFeeConfig,
	currentEpoch: number,
): number =>
	config.pendingEpoch !== 0 && currentEpoch >= config.pendingEpoch
		? config.pendingBps
		: config.feeBps;
