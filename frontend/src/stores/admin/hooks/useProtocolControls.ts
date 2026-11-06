import { useLingui } from "@lingui/react";
import { useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { notification } from "@/components/Notifications";
import {
	getProtocolPDA,
	useVesolveProgram,
	VESOLVE_PROGRAM_ID,
} from "@/hooks/useVesolveProgram";

export type PauseFlags = {
	global: boolean;
	voting: boolean;
	bribes: boolean;
	claims: boolean;
	exit: boolean;
	gaugeActivation: boolean;
	emissions: boolean;
};

export const NO_PAUSES: PauseFlags = {
	global: false,
	voting: false,
	bribes: false,
	claims: false,
	exit: false,
	gaugeActivation: false,
	emissions: false,
};

type RawAdminConfig = {
	pendingAdmin: PublicKey;
	pausedGlobal: boolean;
	pausedVoting: boolean;
	pausedBribes: boolean;
	pausedClaims: boolean;
	pausedExit: boolean;
	pausedGaugeActivation: boolean;
	pausedEmissions: boolean;
	gatePhiSet: boolean;
	gatePhiPpm: number;
	treasury: PublicKey;
};

type RawBribeToken = { allowed: boolean; paused: boolean };

const getAdminConfigPDA = (): [PublicKey, number] =>
	PublicKey.findProgramAddressSync(
		[Buffer.from("admin_config")],
		VESOLVE_PROGRAM_ID,
	);

const getBribeTokenPDA = (mint: PublicKey): [PublicKey, number] =>
	PublicKey.findProgramAddressSync(
		[Buffer.from("bribe_token"), mint.toBuffer()],
		VESOLVE_PROGRAM_ID,
	);

type Fetcher<T> = { fetchNullable: (address: PublicKey) => Promise<T | null> };

/**
 * Pause flags and pending Admin handover
 * (programs/vesolve/src/states/admin_config.rs). A missing account means
 * nothing is paused and no handover is pending.
 */
export const useAdminConfig = () => {
	const program = useVesolveProgram();

	return useQuery({
		queryKey: ["vesolve-admin-config"],
		queryFn: async () => {
			const accounts = program.account as unknown as Record<
				string,
				Fetcher<RawAdminConfig>
			>;
			const raw = await accounts.adminConfig.fetchNullable(
				getAdminConfigPDA()[0],
			);
			const pauses: PauseFlags = raw
				? {
						global: raw.pausedGlobal,
						voting: raw.pausedVoting,
						bribes: raw.pausedBribes,
						claims: raw.pausedClaims,
						exit: raw.pausedExit,
						gaugeActivation: raw.pausedGaugeActivation,
						emissions: raw.pausedEmissions,
					}
				: NO_PAUSES;
			const pendingAdmin =
				raw && !raw.pendingAdmin.equals(PublicKey.default)
					? raw.pendingAdmin.toBase58()
					: null;
			const gatePpm = raw?.gatePhiSet ? raw.gatePhiPpm : null;
			const treasury =
				raw && !raw.treasury.equals(PublicKey.default)
					? raw.treasury.toBase58()
					: null;
			return { pauses, pendingAdmin, gatePpm, treasury };
		},
		staleTime: 15_000,
	});
};

export const useBribeTokenPolicy = (mint: PublicKey | null) => {
	const program = useVesolveProgram();

	return useQuery({
		queryKey: ["vesolve-bribe-token", mint?.toBase58()],
		enabled: !!mint,
		queryFn: async () => {
			if (!mint) return null;
			const accounts = program.account as unknown as Record<
				string,
				Fetcher<RawBribeToken>
			>;
			return accounts.bribeToken.fetchNullable(getBribeTokenPDA(mint)[0]);
		},
	});
};

/** Shared plumbing: sign as the connected wallet, confirm, refresh, toast. */
const useAdminAction = <T>(
	key: string,
	title: string,
	invalidate: string,
	send: (
		program: ReturnType<typeof useVesolveProgram>,
		admin: PublicKey,
		input: T,
	) => Promise<string>,
) => {
	const { i18n } = useLingui();
	const { publicKey } = useWallet();
	const program = useVesolveProgram();
	const queryClient = useQueryClient();

	return useMutation({
		mutationKey: [key],
		mutationFn: async (input: T) => {
			if (!publicKey) throw new Error(i18n._("Connect Wallet"));
			const signature = await send(program, publicKey, input);
			await program.provider.connection.confirmTransaction(
				signature,
				"confirmed",
			);
			return signature;
		},
		onSuccess: async () => {
			notification.success({ title, message: i18n._("Transaction confirmed") });
			await queryClient.invalidateQueries({ queryKey: [invalidate] });
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

export const useSetPauses = () => {
	const { i18n } = useLingui();
	return useAdminAction<PauseFlags>(
		"vesolve-set-pauses",
		i18n._("Pauses"),
		"vesolve-admin-config",
		(program, admin, flags) =>
			program.methods
				.setPauses(flags)
				.accounts({ admin, protocol: getProtocolPDA()[0] })
				.rpc(),
	);
};

export const useProposeAdmin = () => {
	const { i18n } = useLingui();
	return useAdminAction<PublicKey>(
		"vesolve-propose-admin",
		i18n._("Admin transfer"),
		"vesolve-admin-config",
		(program, admin, newAdmin) =>
			program.methods
				.proposeAdmin(newAdmin)
				.accounts({ admin, protocol: getProtocolPDA()[0] })
				.rpc(),
	);
};

export const useAcceptAdmin = () => {
	const { i18n } = useLingui();
	return useAdminAction<undefined>(
		"vesolve-accept-admin",
		i18n._("Admin transfer"),
		"vesolve-admin-config",
		(program, newAdmin) =>
			program.methods
				.acceptAdmin()
				.accounts({ newAdmin, protocol: getProtocolPDA()[0] })
				.rpc(),
	);
};

export const useSetBribeToken = () => {
	const { i18n } = useLingui();
	return useAdminAction<{
		mint: PublicKey;
		allowed: boolean;
		paused: boolean;
	}>(
		"vesolve-set-bribe-token",
		i18n._("Bribe tokens"),
		"vesolve-bribe-token",
		(program, admin, { mint, allowed, paused }) =>
			program.methods
				.setBribeToken(allowed, paused)
				.accounts({
					admin,
					protocol: getProtocolPDA()[0],
					tokenMint: mint,
				})
				.rpc(),
	);
};

export const useSetGateThreshold = () => {
	const { i18n } = useLingui();
	return useAdminAction<number>(
		"vesolve-set-gate-threshold",
		i18n._("Activity gate"),
		"vesolve-admin-config",
		(program, admin, ppm) =>
			program.methods
				.setGateThreshold(ppm)
				.accounts({ admin, protocol: getProtocolPDA()[0] })
				.rpc(),
	);
};

export const useSetTreasury = () => {
	const { i18n } = useLingui();
	return useAdminAction<PublicKey>(
		"vesolve-set-treasury",
		i18n._("Treasury"),
		"vesolve-admin-config",
		(program, admin, treasury) =>
			program.methods
				.setTreasury(treasury)
				.accounts({ admin, protocol: getProtocolPDA()[0] })
				.rpc(),
	);
};
