"use client";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { PublicKey, Transaction } from "@solana/web3.js";
// biome-ignore lint/style/useNodejsImportProtocol: browser Buffer polyfill, not a Node import.
import { Buffer } from "buffer";
import { useEffect, useRef, useState } from "react";
import { useQuestSession } from "./QuestSessionProvider";

type Prepared = {
	transaction: string;
	mint: string;
	wallet: string;
	maxCostLamports: number;
	blockhash: string;
	lastValidBlockHeight: number;
	status: string;
};
export function PassMintButton({ className }: { className?: string }) {
	const { client, state, wallet, network } = useQuestSession();
	const { signTransaction } = useWallet(),
		{ connection } = useConnection();
	const [prepared, setPrepared] = useState<Prepared | null>(null);
	const [result, setResult] = useState<{
		wallet: string;
		mint: string;
		status: string;
	} | null>(null);
	const [busy, setBusy] = useState(false),
		[error, setError] = useState<string | null>(null);
	const identity = useRef({ wallet, network, status: state.status });
	identity.current = { wallet, network, status: state.status };
	// biome-ignore lint/correctness/useExhaustiveDependencies: identity changes must reset private mint state.
	useEffect(() => {
		setPrepared(null);
		setResult(null);
		setError(null);
		setBusy(false);
	}, [wallet, network, state.status]);
	const visible =
		state.status === "READY" &&
		network === "devnet" &&
		result?.wallet === wallet
			? result
			: null;
	const current = (expected: string | null) =>
		identity.current.wallet === expected &&
		identity.current.network === "devnet" &&
		identity.current.status === "READY";
	async function verify() {
		const expected = wallet;
		setBusy(true);
		setError(null);
		try {
			const r = await client?.pass("status");
			if (current(expected) && r) setResult(r);
		} catch {
			if (current(expected))
				setError(
					"Pass verification is unavailable. Retry verification before minting again.",
				);
		} finally {
			if (current(expected)) setBusy(false);
		}
	}
	async function mint() {
		if (!client || !wallet || !signTransaction || network !== "devnet") return;
		const expected = wallet;
		setBusy(true);
		setError(null);
		try {
			if (
				(await connection.getGenesisHash()) !==
				"EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG"
			)
				throw Error("Wrong network");
			if (!current(expected)) return;
			if (!prepared) {
				const p = await client.pass("prepare");
				if (!current(expected)) return;
				if (p.status !== "PREPARED") {
					setResult(p);
					return;
				}
				if (
					!Number.isSafeInteger(p.maxCostLamports) ||
					p.maxCostLamports < 1 ||
					p.maxCostLamports > 201_000_000 ||
					typeof p.transaction !== "string" ||
					p.transaction.length > 4000
				)
					throw Error("Invalid mint");
				setPrepared(p);
				return;
			}
			const tx = Transaction.from(Buffer.from(prepared.transaction, "base64"));
			if (
				!tx.feePayer?.equals(new PublicKey(wallet)) ||
				tx.recentBlockhash !== prepared.blockhash
			)
				throw Error("Invalid payer");
			const message = Buffer.from(tx.serializeMessage());
			const signed = await signTransaction(tx);
			if (!current(expected)) return;
			if (!message.equals(Buffer.from(signed.serializeMessage())))
				throw Error("Transaction changed");
			const signature = await connection.sendRawTransaction(
				signed.serialize(),
				{ skipPreflight: false, maxRetries: 3 },
			);
			if (!current(expected)) return;
			setPrepared(null);
			setResult({ wallet: expected, mint: prepared.mint, status: "PENDING" });
			const confirmation = await connection.confirmTransaction(
				{
					signature,
					blockhash: prepared.blockhash,
					lastValidBlockHeight: prepared.lastValidBlockHeight,
				},
				"finalized",
			);
			if (confirmation.value.err) throw Error("Mint failed");
			if (current(expected)) {
				const r = await client.pass("status");
				if (current(expected)) setResult(r);
			}
		} catch {
			if (current(expected)) {
				setPrepared(null);
				setError(
					"Mint did not verify. Check your Devnet SOL balance or verify an already submitted mint before retrying.",
				);
			}
		} finally {
			if (current(expected)) setBusy(false);
		}
	}
	return (
		<div>
			<button
				type="button"
				className={className}
				disabled={
					process.env.NEXT_PUBLIC_QUEST_PASS_MINT_ENABLED !== "true" ||
					busy ||
					state.status !== "READY" ||
					network !== "devnet" ||
					!signTransaction ||
					visible?.status === "MINTED" ||
					visible?.status === "PENDING" ||
					visible?.status === "UNAVAILABLE"
				}
				onClick={() => void mint()}
			>
				{busy
					? "Checking Devnet Pass…"
					: visible?.status === "MINTED"
						? "Minted"
						: prepared
							? `Approve mint (up to ${(prepared.maxCostLamports / 1e9).toFixed(9)} SOL)`
							: "Mint your Devnet Pass"}
			</button>
			<p>
				Devnet test only. No mint price. You pay the network fee and account
				creation costs using Devnet SOL. No live XP.
			</p>
			{visible && (
				<p role="status">
					{visible.status === "MINTED"
						? "Verified non-transferable Devnet Pass"
						: visible.status === "PENDING"
							? "Submitted; waiting for on-chain verification."
							: "Pass not yet verified."}{" "}
					<a
						href={`https://explorer.solana.com/address/${encodeURIComponent(visible.mint)}?cluster=devnet`}
						target="_blank"
						rel="noreferrer"
					>
						View mint
					</a>
				</p>
			)}
			{visible?.status !== "MINTED" && (
				<button
					type="button"
					disabled={busy || state.status !== "READY" || network !== "devnet"}
					onClick={() => void verify()}
				>
					Verify existing Pass
				</button>
			)}
			{error && <p role="alert">{error}</p>}
		</div>
	);
}
