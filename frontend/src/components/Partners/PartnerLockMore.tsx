"use client";

import { BN } from "@coral-xyz/anchor";
import {
	getAssociatedTokenAddressSync,
	TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { useWallet } from "@solana/wallet-adapter-react";
import { Transaction } from "@solana/web3.js";
import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { SOLVE } from "@/configs/tokens";
import { useAllTokenBalances } from "@/hooks/useCurrencyBalanace";
import { usePartnerLockStates } from "@/hooks/usePartnerLockStates";
import {
	getLockPDA,
	getProtocolPDA,
	useVesolveProgram,
	vesolveAccount,
} from "@/hooks/useVesolveProgram";
import {
	lockFraction,
	parseSolv3Amount,
	preferredLock,
} from "@/lib/partnerLockState";
import { useLocks } from "@/stores/lock/hooks/useLocks";
import classes from "./PartnerSpace.module.css";

const solv3 = (raw: bigint) =>
	(Number(raw) / 10 ** SOLVE.decimals).toLocaleString("en-US", {
		maximumFractionDigits: 4,
	});

/**
 * Adds SOLV3 to a veSOLV3 the partner already holds, with Half and Max buttons. Adding to an existing lock keeps its
 * number, its enrollment and its voter choice, so it stays on auto-vote and the new voting power is picked up the next
 * time the voter votes it (re-voting inside an epoch replaces the earlier vote). A brand-new lock would be a different
 * id that is not on auto-vote, so creating one is a separate, secondary link.
 */
export const PartnerLockMore: React.FC<{ registeredWallets: string[] }> = ({
	registeredWallets,
}) => {
	const { publicKey } = useWallet();
	const program = useVesolveProgram();
	const queryClient = useQueryClient();
	const wallet = publicKey?.toBase58();
	const registered = Boolean(wallet && registeredWallets.includes(wallet));
	const { data: walletLocks } = useLocks();
	const eligible = registered ? (walletLocks ?? []) : [];
	const states = usePartnerLockStates(eligible);
	const { data: balances } = useAllTokenBalances();
	const balance = BigInt(balances?.[SOLVE.address]?.toString() ?? "0");

	const [amount, setAmount] = useState("");
	const [targetId, setTargetId] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const [message, setMessage] = useState<string | null>(null);

	const rows = (
		states.data ?? eligible.map((lock) => ({ lock, state: "off" as const }))
	).map((row) => ({
		...row,
		amount: BigInt(row.lock.tokenAmount.toString()),
	}));
	const preferred = preferredLock(rows);
	const target = rows.find(
		(row) =>
			row.lock.identifier.toString() ===
			(targetId ?? preferred?.lock.identifier.toString()),
	);
	const parsed = parseSolv3Amount(amount, SOLVE.decimals);
	const valid = parsed !== null && parsed > BigInt(0) && parsed <= balance;

	const submit = async () => {
		if (!publicKey || !target || parsed === null || !valid) return;
		setBusy(true);
		setMessage(null);
		try {
			const [protocolAddress] = getProtocolPDA();
			const protocol = await vesolveAccount
				.protocol(program)
				.fetch(protocolAddress);
			const id = target.lock.identifier.toString();
			const [lockAddress] = getLockPDA(BigInt(id));
			const instruction = await program.methods
				.increaseLock(new BN(id), new BN(parsed.toString()))
				.accounts({
					user: publicKey,
					protocol: protocolAddress,
					lock: lockAddress,
					userTokenAccount: getAssociatedTokenAddressSync(
						protocol.tokenMint,
						publicKey,
					),
					tokenMint: protocol.tokenMint,
					protocolTokenAccount: getAssociatedTokenAddressSync(
						protocol.tokenMint,
						protocolAddress,
						true,
					),
					tokenProgram: TOKEN_PROGRAM_ID,
				})
				.instruction();
			await program.provider.sendAndConfirm?.(
				new Transaction().add(instruction),
			);
			setMessage(
				`Added ${solv3(parsed)} SOLV3 to veSOLV3 #${id}. It keeps its number and its auto-vote setting; the extra voting power is counted at the next vote while voting is open.`,
			);
			setAmount("");
			await Promise.all([
				queryClient.invalidateQueries({ queryKey: ["vesolve-locks"] }),
				queryClient.invalidateQueries({ queryKey: ["token-balances"] }),
				queryClient.invalidateQueries({ queryKey: ["partner-lock-states"] }),
			]);
		} catch (e) {
			setMessage(
				e instanceof Error && e.message
					? e.message
					: "That did not go through. Try again.",
			);
		} finally {
			setBusy(false);
		}
	};

	return (
		<section className={classes.panel} aria-label="Grow vote ownership">
			<div>
				<h2>Grow vote ownership</h2>
				<p>
					Add SOLV3 to your veSOLV3 (1:1). More voting power steers more rewards
					to your pool, and the veSOLV3 keeps its number and stays on auto-vote.
				</p>
			</div>
			{!registered ? (
				<p className={classes.muted}>
					Open this space with one of your registered partner wallets to add to
					a lock.
				</p>
			) : rows.length === 0 ? (
				<>
					<p className={classes.muted}>
						Your registered wallet holds no veSOLV3 yet. Create your first lock,
						then turn on auto-vote above.
					</p>
					<Link href="/lock" className={classes.primary}>
						Create your first lock
					</Link>
				</>
			) : (
				<>
					{rows.length > 1 && (
						<label className={classes.field}>
							Add to
							<select
								value={target?.lock.identifier.toString() ?? ""}
								onChange={(event) => setTargetId(event.target.value)}
								disabled={busy}
							>
								{rows.map((row) => (
									<option
										key={row.lock.address.toBase58()}
										value={row.lock.identifier.toString()}
									>
										veSOLV3 #{row.lock.identifier.toString()} ·{" "}
										{solv3(row.amount)} SOLV3
										{row.state === "free"
											? " · free auto-vote"
											: row.state === "public"
												? " · auto-vote"
												: ""}
									</option>
								))}
							</select>
						</label>
					)}
					<label className={classes.field}>
						SOLV3 to add
						<span>
							<input
								inputMode="decimal"
								value={amount}
								onChange={(event) => setAmount(event.target.value)}
								placeholder="0"
								disabled={busy}
							/>
							<b>SOLV3</b>
						</span>
					</label>
					<div className={classes.chips}>
						<span className={classes.muted}>Balance {solv3(balance)}</span>
						<button
							type="button"
							disabled={busy || balance === BigInt(0)}
							onClick={() =>
								setAmount(lockFraction(balance, SOLVE.decimals, 0.5).text)
							}
						>
							Half
						</button>
						<button
							type="button"
							disabled={busy || balance === BigInt(0)}
							onClick={() =>
								setAmount(lockFraction(balance, SOLVE.decimals, 1).text)
							}
						>
							Max
						</button>
					</div>
					<p className={classes.muted}>
						You receive{" "}
						<b>{valid && parsed !== null ? solv3(parsed) : "0"} veSOLV3</b>
						{target ? ` added to #${target.lock.identifier.toString()}` : ""}.
					</p>
					<div className={classes.actions}>
						<button
							type="button"
							className={classes.primary}
							disabled={!valid || busy || !target}
							onClick={() => void submit()}
						>
							{busy
								? "Confirm in your wallet…"
								: target
									? `Add to veSOLV3 #${target.lock.identifier.toString()}`
									: "Add to lock"}
						</button>
					</div>
					{amount && parsed !== null && parsed > balance && (
						<p className={classes.muted} role="status">
							That is more than your SOLV3 balance.
						</p>
					)}
					<p className={classes.muted}>
						Need a separate lock instead?{" "}
						<Link href="/lock">Create a new lock</Link>. A new lock is a
						different number and is not on auto-vote until you turn it on above.
					</p>
				</>
			)}
			{message && (
				<p className={classes.muted} role="status">
					{message}
				</p>
			)}
		</section>
	);
};
