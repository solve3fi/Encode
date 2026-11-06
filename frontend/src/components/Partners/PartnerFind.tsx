"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { partnerSpaceLookupMessage } from "@/configs/partnerSpaces";
import { ModalType } from "@/stores/modal";
import { useModalActions } from "@/stores/modal/ModalProvider";
import classes from "./PartnerSpace.module.css";

type Found = { slug: string; projectName: string };

/** Lost your link? A registered wallet can sign to be taken to its partner space. */
export const PartnerFind: React.FC = () => {
	const { publicKey, signMessage } = useWallet();
	const { setOpenModal } = useModalActions();
	const router = useRouter();
	const [state, setState] = useState<"idle" | "signing" | "none" | "error">("idle");
	const [spaces, setSpaces] = useState<Found[]>([]);

	const find = async () => {
		if (!publicKey || !signMessage) return;
		setState("signing");
		try {
			const wallet = publicKey.toBase58();
			const issuedAt = Date.now();
			const bytes = await signMessage(new TextEncoder().encode(partnerSpaceLookupMessage(wallet, issuedAt)));
			const res = await fetch("/api/partner-space/mine", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				cache: "no-store",
				body: JSON.stringify({ wallet, issuedAt, signature: Buffer.from(bytes).toString("base64") }),
			});
			if (!res.ok) throw new Error();
			const found = ((await res.json()) as { spaces: Found[] }).spaces;
			if (found.length === 1) {
				router.push(`/partner/${found[0].slug}`);
				return;
			}
			setSpaces(found);
			setState(found.length === 0 ? "none" : "idle");
		} catch {
			setState("error");
		}
	};

	return (
		<div className={classes.page}>
			<header className={classes.head}>
				<span className={classes.eyebrow}>Partner space</span>
				<h1>Find your <span className={classes.grad}>partner space.</span></h1>
				<p>
					Your space is private to the wallets your team registered. Use your private link, or connect a registered wallet and sign one free message to be taken there.
				</p>
				<div className={classes.actions}>
					{publicKey ? (
						<button type="button" className={classes.primary} disabled={state === "signing" || !signMessage} onClick={() => void find()}>
							{state === "signing" ? "Approve in your wallet…" : "Find my space"}
						</button>
					) : (
						<button type="button" className={classes.primary} onClick={() => setOpenModal(ModalType.WALLET)}>Connect wallet</button>
					)}
					<Link href="/partners/onboarding" className={classes.ghost}>Start onboarding</Link>
				</div>
				{state === "none" && (
					<p className={classes.muted} role="status">
						No partner space lists this wallet yet. If your listing is approved, ask Solve3 to register this wallet at admin@solve3.fi.
					</p>
				)}
				{state === "error" && <p className={classes.muted} role="alert">That did not work. Try again.</p>}
				{spaces.length > 1 && (
					<div className={classes.actions}>
						{spaces.map((space) => (
							<Link key={space.slug} href={`/partner/${space.slug}`} className={classes.ghost}>{space.projectName}</Link>
						))}
					</div>
				)}
			</header>
		</div>
	);
};
