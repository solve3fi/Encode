import { useWallet } from "@solana/wallet-adapter-react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
	type PartnerSpaceView,
	partnerSpaceAccessMessage,
} from "@/configs/partnerSpaces";

export type PartnerAccessStatus =
	| "disconnected"
	| "checking"
	| "needs-signature"
	| "signing"
	| "ready"
	| "denied"
	| "error";

type Stored = { token: string; expiresAt: number };
const key = (slug: string, wallet: string) => `solve3-partner-space:${slug}:${wallet}`;
const read = (slug: string, wallet: string): Stored | null => {
	try {
		const raw = window.sessionStorage.getItem(key(slug, wallet));
		const value = raw ? (JSON.parse(raw) as Stored) : null;
		return value && value.expiresAt > Date.now() ? value : null;
	} catch {
		return null;
	}
};
const write = (slug: string, wallet: string, value: Stored | null) => {
	try {
		if (value) window.sessionStorage.setItem(key(slug, wallet), JSON.stringify(value));
		else window.sessionStorage.removeItem(key(slug, wallet));
	} catch {
		// Private browsing: the wallet is simply asked again.
	}
};

/**
 * Opens a partner space for the connected wallet. The link alone shows nothing: the wallet signs a
 * message, the server checks it against the space's wallet list, and returns a short-lived token that
 * is kept for this browser session only.
 */
export function usePartnerSpaceAccess(slug: string) {
	const { publicKey, signMessage } = useWallet();
	const wallet = publicKey?.toBase58() ?? null;
	const [status, setStatus] = useState<PartnerAccessStatus>("disconnected");
	const [space, setSpace] = useState<PartnerSpaceView | null>(null);
	const [error, setError] = useState<string | null>(null);
	const generation = useRef(0);

	// Wallet change or disconnect: forget everything shown for the previous wallet.
	useEffect(() => {
		const mine = ++generation.current;
		setSpace(null);
		setError(null);
		if (!wallet) {
			setStatus("disconnected");
			return;
		}
		const stored = read(slug, wallet);
		if (!stored) {
			setStatus("needs-signature");
			return;
		}
		setStatus("checking");
		fetch(`/api/partner-space/${slug}`, {
			headers: { Authorization: `Bearer ${stored.token}` },
			cache: "no-store",
		})
			.then(async (res) => {
				if (mine !== generation.current) return;
				if (res.ok) {
					setSpace(((await res.json()) as { space: PartnerSpaceView }).space);
					setStatus("ready");
				} else {
					write(slug, wallet, null);
					setStatus(res.status === 404 ? "denied" : "needs-signature");
				}
			})
			.catch(() => {
				if (mine === generation.current) setStatus("needs-signature");
			});
	}, [slug, wallet]);

	const verify = useCallback(async () => {
		if (!wallet || !signMessage) return;
		const mine = generation.current;
		setStatus("signing");
		setError(null);
		try {
			const issuedAt = Date.now();
			const bytes = await signMessage(new TextEncoder().encode(partnerSpaceAccessMessage(slug, wallet, issuedAt)));
			const res = await fetch("/api/partner-space/access", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				cache: "no-store",
				body: JSON.stringify({ slug, wallet, issuedAt, signature: Buffer.from(bytes).toString("base64") }),
			});
			if (mine !== generation.current) return;
			const data = await res.json();
			if (res.ok) {
				write(slug, wallet, { token: data.token, expiresAt: data.expiresAt });
				setSpace(data.space as PartnerSpaceView);
				setStatus("ready");
			} else if (res.status === 404) {
				setStatus("denied");
			} else {
				setError(data.error ?? "Could not verify this wallet.");
				setStatus("error");
			}
		} catch {
			if (mine !== generation.current) return;
			// A rejected signature is not a failure of the page; offer to try again.
			setStatus("needs-signature");
			setError("The signature was not approved.");
		}
	}, [slug, wallet, signMessage]);

	const signOut = useCallback(() => {
		if (wallet) write(slug, wallet, null);
		setSpace(null);
		setStatus(wallet ? "needs-signature" : "disconnected");
	}, [slug, wallet]);

	return { status, space, error, verify, signOut, wallet, canSign: Boolean(signMessage) };
}
