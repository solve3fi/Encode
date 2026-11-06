import { useWallet } from "@solana/wallet-adapter-react";
import { useQuery } from "@tanstack/react-query";
import { isVesolveAdmin } from "@/configs/admins";
import { useAdminConfig } from "@/stores/admin/hooks/useProtocolControls";
import {
	getProtocolPDA,
	useVesolveProgram,
	vesolveAccount,
} from "./useVesolveProgram";

/**
 * Whether the connected wallet is allowed to sign vesolve's admin
 * instructions. On chain the Admin is `protocol.admin`, which can be handed
 * over with propose_admin/accept_admin; the compiled ADMINS list only
 * bootstraps `initialize`. This is a client-side convenience check: it
 * follows protocol.admin (falling back to the bootstrap list until the
 * protocol account loads) and also admits a wallet with a pending handover
 * so it can reach the accept button.
 */
export const useProtocolAdmin = () => {
	const { publicKey } = useWallet();
	const program = useVesolveProgram();

	const query = useQuery({
		queryKey: ["vesolve-protocol-admin"],
		queryFn: async () => {
			const [protocolAddress] = getProtocolPDA();
			return vesolveAccount.protocol(program).fetchNullable(protocolAddress);
		},
	});

	const { data: adminConfig } = useAdminConfig();

	const protocolAdmin = query.data?.admin ?? null;
	const wallet = publicKey?.toBase58();
	const isAdmin = protocolAdmin
		? protocolAdmin.toString() === wallet ||
			adminConfig?.pendingAdmin === wallet
		: isVesolveAdmin(publicKey);

	return { isAdmin, protocolAdmin, isLoading: query.isLoading };
};
