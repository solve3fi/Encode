"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { usePathname } from "next/navigation";
import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useRef,
	useState,
} from "react";
import { useCluster } from "@/providers/ClusterProvider";
import { createQuestBrowserClient } from "../../../scripts/quest/quest-browser-client.mjs";

type Client = ReturnType<typeof createQuestBrowserClient>;
const initial = {
	status: "DISCONNECTED",
	error: null,
	snapshot: null,
	history: null,
	xp: null,
};
type Session = {
	client: Client | null;
	state: ReturnType<Client["getState"]>;
	wallet: string | null;
	network: string;
	signMessage: ReturnType<typeof useWallet>["signMessage"];
};
const Context = createContext<Session | null>(null);

export function QuestSessionProvider({ children }: { children: ReactNode }) {
	const { publicKey, signMessage } = useWallet(),
		{ network } = useCluster();
	const wallet = publicKey?.toBase58() ?? null;
	const pathname = usePathname();
	const activePage = pathname
		.split("/")
		.some((part) => part === "quests" || part === "pass");
	const campaign = process.env.NEXT_PUBLIC_QUEST_TEST_CAMPAIGN;
	const [client, setClient] = useState<Client | null>(null);
	const [state, setState] = useState<Session["state"]>(initial);
	const last = useRef({
		wallet: null as string | null,
		network: "",
		client: null as Client | null,
	});
	const attempted = useRef(false);
	const rejectionKey = `solve3:quest-signature-declined:${network}:${wallet ?? "none"}`;
	const signForQuest = useCallback<NonNullable<Session["signMessage"]>>(
		async (message) => {
			if (!signMessage) throw new Error("Wallet signature unavailable");
			try {
				const signature = await signMessage(message);
				try {
					sessionStorage.removeItem(rejectionKey);
				} catch {
					/* Storage may be disabled. */
				}
				return signature;
			} catch (error) {
				try {
					sessionStorage.setItem(rejectionKey, "1");
				} catch {
					/* In-memory guard still applies. */
				}
				throw error;
			}
		},
		[signMessage, rejectionKey],
	);
	useEffect(() => {
		if (!campaign || window.location.protocol !== "https:") return;
		const instance = createQuestBrowserClient({
			origin: window.location.origin,
			campaignId: campaign,
			onChange: (s) => setState(s as Session["state"]),
		});
		setClient(instance);
		return () => instance.dispose();
	}, [campaign]);
	useEffect(() => {
		if (!client) return;
		if (
			last.current.wallet !== wallet ||
			last.current.network !== network ||
			last.current.client !== client
		) {
			if (
				last.current.wallet &&
				(last.current.wallet !== wallet || last.current.network !== network)
			) {
				try {
					sessionStorage.removeItem(
						`solve3:quest-signature-declined:${last.current.network}:${last.current.wallet}`,
					);
				} catch {
					/* Storage may be disabled. */
				}
			}
			last.current = { wallet, network, client };
			attempted.current = false;
			client.setIdentity(wallet, network);
		}
		if (
			activePage &&
			wallet &&
			network === "devnet" &&
			signMessage &&
			!attempted.current
		) {
			// Set before awaiting: rejection, rerenders and route changes cannot loop.
			const timer = setTimeout(() => {
				attempted.current = true;
				void client.connect(async (message: Uint8Array) => {
					let declined = false;
					try {
						declined = sessionStorage.getItem(rejectionKey) === "1";
					} catch {
						/* In-memory guard still applies. */
					}
					if (declined) throw new Error("Use Retry wallet sign-in");
					return signForQuest(message);
				});
			}, 0);
			return () => clearTimeout(timer);
		}
	}, [
		client,
		wallet,
		network,
		signMessage,
		signForQuest,
		rejectionKey,
		activePage,
	]);
	const changed =
		last.current.wallet !== wallet || last.current.network !== network;
	return (
		<Context.Provider
			value={{
				client,
				state: changed ? initial : state,
				wallet,
				network,
				signMessage: signMessage ? signForQuest : undefined,
			}}
		>
			{children}
		</Context.Provider>
	);
}

export function useQuestSession() {
	const value = useContext(Context);
	if (!value) throw new Error("Quest session provider missing");
	return value;
}
