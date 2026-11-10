"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import Link from "next/link";
import { getLockTokenInfo } from "@/configs/lock";
import { formatDuration } from "@/lib/format";
import { useLocks } from "@/stores/lock/hooks/useLocks";
import { useEpochNow } from "./FlowStrip";

/** "Your voting power" on the Lock page: the wallet's veSOLV3 across its locks, and when voting pauses. */
export const LockPowerCard: React.FC = () => {
	const { publicKey } = useWallet();
	const { data: locks, isLoading } = useLocks();
	const e = useEpochNow();
	const total = (locks ?? []).reduce((sum, lock) => {
		const decimals = getLockTokenInfo(lock.lockTokenMint.toBase58()).decimals;
		return sum + Number(lock.lockPower.toString()) / 10 ** decimals;
	}, 0);
	const open = e?.state === "open";
	return (
		<section className="ap" aria-label="Your voting power">
			<div className="ap-h">
				<span className="fc-eyebrow">YOUR VOTING POWER</span>
			</div>
			{!publicKey ? (
				<p className="ap-note">Connect a wallet to see your voting power.</p>
			) : isLoading ? (
				<p className="ap-note">Reading your locks…</p>
			) : (
				<>
					<div className="ap-big">
						{total.toLocaleString("en-US", { maximumFractionDigits: 2 })} <small>veSOLV3</small>
					</div>
					<p className="ap-note">
						{(locks ?? []).length === 0
							? "No locks yet. Create one to get voting power."
							: open && e
								? `Voting is open and closes in ${formatDuration(e.toEnd - 300)} for Epoch ${e.epoch}.`
								: "Voting is paused for the last minutes of the epoch."}
					</p>
					<Link href="/arena" className="btn2 pri" style={{ alignSelf: "flex-start" }}>
						Vote in the Arena
					</Link>
				</>
			)}
		</section>
	);
};
