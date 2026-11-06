"use client";

import { BN } from "@coral-xyz/anchor";
import { useWallet } from "@solana/wallet-adapter-react";
import {
	type PublicKey,
	SystemProgram,
	Transaction,
	type TransactionInstruction,
} from "@solana/web3.js";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { partnerDefaultsMessage } from "@/configs/partnerDefaults";
import { PARTNER_VOTER } from "@/configs/partnerVoter";
import { usePartnerLockStates } from "@/hooks/usePartnerLockStates";
import { usePartnerVoters } from "@/hooks/usePartnerVoters";
import {
	getAutoVoteDelegatePDA,
	getAutoVoteEnrollmentPDA,
	getAutoVoterPDA,
	useVesolveProgram,
} from "@/hooks/useVesolveProgram";
import { useLocks } from "@/stores/lock/hooks/useLocks";
import classes from "./PartnerSpace.module.css";

const CHUNK = 5;
const FEE_PERCENT = 15;

const solv3 = (raw: BN) =>
	(Number(raw.toString()) / 1e9).toLocaleString("en-US", {
		maximumFractionDigits: 2,
	});

/**
 * Auto-vote for the partner's own gauge, one registered veSOLV3 at a time. Only veSOLV3 held by a wallet registered
 * on this partner space can be chosen: the list is the connected (registered) wallet's own locks and there is no way to
 * type in another id. Turning a lock on enrolls it in Auto-Vote and, once the shared partner voter is flagged on
 * chain, picks that voter, so the lock is voted for this partner's gauge only and pays no Auto-Vote fee. The keeper
 * refuses to vote a partner-voter lock anywhere else, or for a wallet that is not registered on a partner space.
 * Adding SOLV3 to a lock keeps its id, its enrollment and its voter choice, so it stays on auto-vote.
 */
export const PartnerAutoVote: React.FC<{
	gaugeActive: boolean;
	gaugeLabel: string;
	registeredWallets: string[];
}> = ({ gaugeActive, gaugeLabel, registeredWallets }) => {
	const { publicKey, signMessage } = useWallet();
	const program = useVesolveProgram();
	const queryClient = useQueryClient();
	const wallet = publicKey?.toBase58();
	const registered = Boolean(wallet && registeredWallets.includes(wallet));
	const { data: partnerVoters = [] } = usePartnerVoters();
	// Only offered once the partner voter is flagged on chain; until then partner locks pay the standard fee.
	const configuredVoter = PARTNER_VOTER;
	const partnerVoter =
		configuredVoter &&
		partnerVoters.some((entry) => entry.voter === configuredVoter.toBase58())
			? configuredVoter
			: null;
	const { data: walletLocks } = useLocks();
	const eligible = registered ? (walletLocks ?? []) : [];
	const states = usePartnerLockStates(eligible);
	const [busy, setBusy] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);

	const preference = useQuery({
		queryKey: ["partner-vote-preference", wallet],
		enabled: Boolean(wallet),
		queryFn: async () => {
			const res = await fetch(`/api/partners/defaults?wallet=${wallet}`, {
				cache: "no-store",
			});
			if (!res.ok) throw new Error("Could not read your setting");
			return (await res.json()) as { vote: boolean; saved: boolean };
		},
	});

	const rows = states.data ?? [];
	const loading =
		preference.isLoading || (eligible.length > 0 && states.isLoading);

	const savePreference = async (vote: boolean) => {
		if (!publicKey || !signMessage)
			throw new Error("This wallet does not support message signing.");
		const message = partnerDefaultsMessage(publicKey.toBase58(), vote, false);
		const signature = Buffer.from(
			await signMessage(new TextEncoder().encode(message)),
		).toString("base64");
		const res = await fetch("/api/partners/defaults", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				wallet: publicKey.toBase58(),
				vote,
				autolock: false,
				signature,
			}),
		});
		if (!res.ok) throw new Error("Could not save your choice. Try again.");
	};

	const send = async (instructions: TransactionInstruction[]) => {
		for (let i = 0; i < instructions.length; i += CHUNK) {
			await program.provider.sendAndConfirm?.(
				new Transaction().add(...instructions.slice(i, i + CHUNK)),
			);
		}
	};

	const enrollIx = (owner: PublicKey, lock: (typeof eligible)[number]) =>
		program.methods
			.enrollAutoVote(new BN(lock.identifier.toString()))
			.accounts({
				owner,
				lock: lock.address,
				enrollment: getAutoVoteEnrollmentPDA(lock.address)[0],
				systemProgram: SystemProgram.programId,
			})
			.instruction();

	const choosePartnerVoterIx = (
		owner: PublicKey,
		lock: (typeof eligible)[number],
	) =>
		program.methods
			.setAutoVoter(new BN(lock.identifier.toString()))
			.accounts({
				owner,
				lock: lock.address,
				enrollment: getAutoVoteEnrollmentPDA(lock.address)[0],
				autoVoter: getAutoVoterPDA(
					partnerVoter as NonNullable<typeof partnerVoter>,
				)[0],
				delegate: getAutoVoteDelegatePDA(lock.address)[0],
				systemProgram: SystemProgram.programId,
			})
			.instruction();

	const clearChoiceIx = (owner: PublicKey, lock: (typeof eligible)[number]) =>
		program.methods
			.clearAutoVoter(new BN(lock.identifier.toString()))
			.accounts({
				owner,
				lock: lock.address,
				delegate: getAutoVoteDelegatePDA(lock.address)[0],
			})
			.instruction();

	const revokeIx = (owner: PublicKey, lock: (typeof eligible)[number]) =>
		program.methods
			.revokeAutoVote(new BN(lock.identifier.toString()))
			.accounts({
				owner,
				lock: lock.address,
				enrollment: getAutoVoteEnrollmentPDA(lock.address)[0],
			})
			.instruction();

	const run = async (label: string, work: () => Promise<void>) => {
		setBusy(label);
		setError(null);
		try {
			await work();
		} catch (e) {
			setError(
				e instanceof Error && e.message
					? e.message
					: "That did not go through. Try again.",
			);
		} finally {
			await Promise.all([preference.refetch(), states.refetch()]);
			await queryClient.invalidateQueries({ queryKey: ["vesolve-locks"] });
			setBusy(null);
		}
	};

	// Choice first, then enrollment: if enrollment fails nothing can vote the lock without the choice.
	const turnOn = (row: (typeof rows)[number]) =>
		run("Confirm in your wallet…", async () => {
			if (!publicKey) return;
			await savePreference(true);
			if (row.state === "off")
				await send([await enrollIx(publicKey, row.lock)]);
			if (partnerVoter && row.state !== "free")
				await send([await choosePartnerVoterIx(publicKey, row.lock)]);
		});

	const turnOff = (row: (typeof rows)[number]) =>
		run("Confirm in your wallet…", async () => {
			if (!publicKey) return;
			// Clearing the partner-voter choice first means the lock is never left on a voter that cannot vote it.
			if (row.state === "free")
				await send([await clearChoiceIx(publicKey, row.lock)]);
			if (row.state !== "off")
				await send([await revokeIx(publicKey, row.lock)]);
			const stillOn = rows.some(
				(other) =>
					other.lock.address !== row.lock.address && other.state !== "off",
			);
			if (!stillOn) await savePreference(false);
		});

	const statusFor = (state: (typeof rows)[number]["state"]) =>
		state === "free"
			? "Free auto-vote on: voted for your gauge only, no Auto-Vote fee."
			: state === "public"
				? partnerVoter
					? "Enrolled, but not on the free partner voter yet."
					: `Auto-vote on: voted for your gauge only. Pays the standard ${FEE_PERCENT}% Auto-Vote fee until the free partner voter is live.`
				: "Off. You vote this lock yourself.";

	const anyOn = rows.some((row) => row.state !== "off");

	return (
		<section className={classes.panel} aria-label="Auto-vote">
			<div>
				<h2>Free auto-vote for our gauge</h2>
				<p>
					Choose which of your registered veSOLV3 to auto-vote. Each one you
					turn on is voted 100% for your own gauge every epoch and nowhere else.
					Only veSOLV3 held by your registered partner wallets can be used.
				</p>
			</div>
			{!registered ? (
				<p className={classes.muted} role="status">
					Open this space with one of your registered partner wallets to set
					this up.
				</p>
			) : loading ? (
				<p className={classes.muted}>Checking your veSOLV3…</p>
			) : rows.length === 0 ? (
				<p className={classes.muted}>
					Your registered wallet holds no veSOLV3 yet. Lock SOLV3 below, then
					turn it on here.
				</p>
			) : (
				rows.map((row) => (
					<div className={classes.toggle} key={row.lock.address.toBase58()}>
						<div>
							<strong>
								veSOLV3 #{row.lock.identifier.toString()} ·{" "}
								{solv3(row.lock.tokenAmount)} SOLV3
							</strong>
							<small>{statusFor(row.state)}</small>
						</div>
						<button
							type="button"
							role="switch"
							aria-checked={row.state !== "off"}
							aria-label={`Auto-vote veSOLV3 #${row.lock.identifier.toString()} for our gauge`}
							disabled={Boolean(busy) || !publicKey}
							onClick={() =>
								void (row.state === "off" ? turnOn(row) : turnOff(row))
							}
							className={classes.switch}
						>
							<span />
						</button>
						{partnerVoter && row.state === "public" && (
							<button
								type="button"
								className={classes.ghost}
								disabled={Boolean(busy)}
								onClick={() => void turnOn(row)}
							>
								Switch to free
							</button>
						)}
					</div>
				))
			)}
			{!gaugeActive && anyOn && (
				<p className={classes.muted} role="status">
					Your gauge is {gaugeLabel.toLowerCase()}. The keeper waits and votes
					once it is active; it will not vote your locks anywhere else.
				</p>
			)}
			<p className={classes.muted} role="status">
				{busy ??
					error ??
					"Adding SOLV3 to a veSOLV3 keeps its number and keeps it on auto-vote. You can turn any one off at any time."}
			</p>
		</section>
	);
};
