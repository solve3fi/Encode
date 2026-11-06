"use client";

import { BN } from "@coral-xyz/anchor";
import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { useWallet } from "@solana/wallet-adapter-react";
import { Transaction } from "@solana/web3.js";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { buildVoteRewardClaimIxs } from "@/hooks/useClaimVoteRewards";
import { usePartnerLockStates } from "@/hooks/usePartnerLockStates";
import { useVoteRewards } from "@/hooks/useVoteRewards";
import { preferredLock } from "@/lib/partnerLockState";
import { getLockPDA, getProtocolPDA, useVesolveProgram, vesolveAccount } from "@/hooks/useVesolveProgram";
import { useAnchor } from "@/providers/DappProvider";
import { useLocks } from "@/stores/lock/hooks/useLocks";
import classes from "./PartnerSpace.module.css";

const SOLV3_DECIMALS = 9;
const fmt = (raw: BN) => (Number(raw.toString()) / 10 ** SOLV3_DECIMALS).toLocaleString("en-US", { maximumFractionDigits: 4 });

/**
 * One approval to claim every voting reward and lock the SOLV3 emissions into the partner's own
 * veSOLV3. Hands-off locking is not possible with the current contracts (claiming and locking both
 * need the owner's signature), so this batches it into a single wallet confirmation instead.
 */
export const PartnerClaimLock: React.FC = () => {
	const { publicKey } = useWallet();
	const program = useVesolveProgram();
	const provider = useAnchor();
	const queryClient = useQueryClient();
	const { data: locks } = useLocks();
	const { data: rewards, isLoading } = useVoteRewards();
	const [busy, setBusy] = useState(false);
	const [message, setMessage] = useState<string | null>(null);

	const rows = (rewards ?? []).filter((row) => row.rewardAmount.gtn(0) || row.poolRewardAmountA.gtn(0) || row.poolRewardAmountB.gtn(0) || row.bribes.some((b) => b.amount.gtn(0)));
	const emissions = rows.reduce((sum, row) => sum.add(row.rewardAmount), new BN(0));
	// Lock into the partner's auto-voted position (largest free one first, then the largest enrolled one, then the
	// largest), so the SOLV3 joins a veSOLV3 that is already on auto-vote and voting power concentrates in one place.
	const states = usePartnerLockStates(locks);
	const target = preferredLock(
		(states.data ?? (locks ?? []).map((lock) => ({ lock, state: "off" as const }))).map((row) => ({
			...row,
			amount: BigInt(row.lock.tokenAmount.toString()),
		})),
	)?.lock;

	const run = async () => {
		if (!publicKey) return;
		setBusy(true);
		setMessage(null);
		try {
			const transactions: Transaction[] = [];
			for (const row of rows) {
				const instructions = await buildVoteRewardClaimIxs(program, publicKey, row);
				if (instructions.length > 0) transactions.push(new Transaction().add(...instructions));
			}
			if (emissions.gtn(0) && target) {
				const [protocolAddress] = getProtocolPDA();
				const protocol = await vesolveAccount.protocol(program).fetch(protocolAddress);
				const [lockAddress] = getLockPDA(BigInt(target.identifier.toString()));
				const lockInstruction = await program.methods
					.increaseLock(new BN(target.identifier.toString()), emissions)
					.accounts({
						user: publicKey,
						protocol: protocolAddress,
						lock: lockAddress,
						userTokenAccount: getAssociatedTokenAddressSync(protocol.tokenMint, publicKey),
						tokenMint: protocol.tokenMint,
						protocolTokenAccount: getAssociatedTokenAddressSync(protocol.tokenMint, protocolAddress, true),
						tokenProgram: TOKEN_PROGRAM_ID,
					})
					.instruction();
				transactions.push(new Transaction().add(lockInstruction));
			}
			if (transactions.length === 0) {
				setMessage("Nothing to claim right now.");
				return;
			}
			// One wallet approval signs the whole batch; the transactions then go out in order.
			await provider.sendAll(transactions.map((tx) => ({ tx })));
			setMessage(
				emissions.gtn(0) && target
					? `Claimed ${rows.length} epoch${rows.length === 1 ? "" : "s"} and locked ${fmt(emissions)} SOLV3 into veSOLV3.`
					: `Claimed ${rows.length} epoch${rows.length === 1 ? "" : "s"}.`,
			);
			await Promise.all([
				queryClient.invalidateQueries({ queryKey: ["vesolve-vote-rewards"] }),
				queryClient.invalidateQueries({ queryKey: ["vesolve-locks"] }),
				queryClient.invalidateQueries({ queryKey: ["totalClaimableRewardsQuote"] }),
			]);
		} catch (e) {
			setMessage(e instanceof Error && e.message ? e.message : "That did not go through. Try again.");
		} finally {
			setBusy(false);
		}
	};

	return (
		<section className={classes.panel} aria-label="Claim and lock">
			<div>
				<h2>Claim all and lock</h2>
				<p>
					One approval claims every voting reward and locks the SOLV3 emissions into your veSOLV3, so your voting power grows each epoch. Fully hands-off locking needs a contract
					update; until then it is one tap.
				</p>
			</div>
			<p className={classes.muted}>
				{isLoading
					? "Reading your rewards…"
					: rows.length === 0
						? "Nothing claimable yet. Rewards for votes in epoch N are claimable from epoch N+1."
						: `${rows.length} epoch${rows.length === 1 ? "" : "s"} ready. ${emissions.gtn(0) ? (target ? `${fmt(emissions)} SOLV3 will be locked into veSOLV3 #${target.identifier.toString()}.` : "Create a lock first to lock your SOLV3.") : "Fees and bribes are claimed to your wallet."}`}
			</p>
			<div className={classes.actions}>
				<button type="button" className={classes.primary} disabled={busy || rows.length === 0 || !publicKey} onClick={() => void run()}>
					{busy ? "Confirm in your wallet…" : "Claim all and lock"}
				</button>
			</div>
			{message && <p className={classes.muted} role="status">{message}</p>}
		</section>
	);
};
