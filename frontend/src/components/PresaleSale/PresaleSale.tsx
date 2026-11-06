"use client";

import {
	Alert,
	Anchor,
	Badge,
	Button,
	Group,
	NumberInput,
	Paper,
	Progress,
	SegmentedControl,
	SimpleGrid,
	Stack,
	Text,
	Title,
} from "@mantine/core";
import {
	createTransferCheckedInstruction,
	getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { useWallet } from "@solana/wallet-adapter-react";
import {
	ComputeBudgetProgram,
	Connection,
	PublicKey,
	SystemProgram,
	Transaction,
	TransactionInstruction,
} from "@solana/web3.js";
import { IconAlertTriangle, IconInfoCircle } from "@tabler/icons-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { ConnectButton } from "@/components/Wallet/ConnectButton";
import {
	MAINNET_USDC_MINT,
	SALE_CONFIRM_PATH,
	SALE_PRICE_USD,
	SALE_QUOTE_PATH,
	SALE_STATUS_PATH,
	type SaleQuote,
	type SaleStatus,
	type SaleToken,
	USDC_DECIMALS,
} from "@/configs/presaleSale";
import { FundNudge } from "@/components/Fund/FundNudge";

const MAINNET_RPC =
	process.env.NEXT_PUBLIC_MAINNET_RPC_URL ||
	"https://api.mainnet-beta.solana.com";
const MEMO_PROGRAM = new PublicKey(
	"MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr",
);
const FEE_BUFFER_LAMPORTS = BigInt(20_000);
const CONFIRM_TIMEOUT_MS = 150_000;

type Step = "idle" | "quoting" | "signing" | "sending" | "confirming" | "done";
const STEP_TEXT: Record<Step, string> = {
	idle: "",
	quoting: "Getting your quote…",
	signing: "Approve the payment in your wallet",
	sending: "Sending the payment on Solana mainnet…",
	confirming: "Verifying the payment…",
	done: "",
};

const usd = (value: number) =>
	`$${value.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
const ve = (value: number) =>
	value.toLocaleString(undefined, { maximumFractionDigits: 3 });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function Countdown({ to, label }: { to: string; label: string }) {
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		const timer = setInterval(() => setNow(Date.now()), 1000);
		return () => clearInterval(timer);
	}, []);
	const left = Math.max(0, Date.parse(to) - now);
	const d = Math.floor(left / 86_400_000);
	const h = Math.floor((left % 86_400_000) / 3_600_000);
	const m = Math.floor((left % 3_600_000) / 60_000);
	const s = Math.floor((left % 60_000) / 1000);
	return (
		<Stack gap={2}>
			<Text c="dimmed" fz="sm">
				{label}
			</Text>
			<Text fw={700} fz="xl" data-numeric="true">
				{d}d {String(h).padStart(2, "0")}h {String(m).padStart(2, "0")}m{" "}
				{String(s).padStart(2, "0")}s
			</Text>
		</Stack>
	);
}

/**
 * Presale round 2: buy veSOLV3 at a fixed price with mainnet USDC or SOL, paid straight to the Treasury and claimed as
 * a permanent veSOLV3 lock at mainnet launch. The server quotes the exact amount, the wallet signs one transfer (plus a
 * memo naming the quote), and the server verifies that payment on chain before recording the allocation.
 */
export function PresaleSale() {
	const { publicKey, signTransaction, connected } = useWallet();
	const wallet = publicKey?.toBase58();
	const queryClient = useQueryClient();
	const connection = useMemo(
		() => new Connection(MAINNET_RPC, "confirmed"),
		[],
	);
	const [token, setToken] = useState<SaleToken>("USDC");
	const [amount, setAmount] = useState<number | string>("");
	const [step, setStep] = useState<Step>("idle");
	const [error, setError] = useState<string | null>(null);
	const [receipt, setReceipt] = useState<{
		signature: string;
		veSolv3: number;
		usd: number;
	} | null>(null);

	const { data: status } = useQuery({
		queryKey: ["presale-sale-status", wallet],
		queryFn: async (): Promise<SaleStatus> => {
			const res = await fetch(
				`${SALE_STATUS_PATH}${wallet ? `?wallet=${wallet}` : ""}`,
				{ cache: "no-store" },
			);
			if (!res.ok) throw new Error("Presale status unavailable");
			return res.json();
		},
		refetchInterval: 15_000,
	});

	const config = status?.config ?? null;
	const usdValue = typeof amount === "number" ? amount : Number(amount) || 0;
	const veFor = usdValue / SALE_PRICE_USD;
	const limit = status?.wallet?.remainingUsd ?? config?.maxUsdPerWallet ?? 0;
	const sold = status?.soldUsd ?? 0;
	const cap = config?.hardCapUsd ?? 0;
	const busy = step !== "idle" && step !== "done";
	const inputError =
		!config || usdValue === 0
			? null
			: !Number.isInteger(usdValue)
				? "Whole dollars only"
				: usdValue < config.minUsd
					? `The minimum is ${usd(config.minUsd)}`
					: usdValue > limit
						? `You can buy up to ${usd(limit)} more`
						: null;

	const buy = async () => {
		if (!publicKey || !signTransaction || !wallet) return;
		setError(null);
		setReceipt(null);
		try {
			setStep("quoting");
			const quoteRes = await fetch(SALE_QUOTE_PATH, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ wallet, token, usd: usdValue }),
			});
			const quote = (await quoteRes.json()) as SaleQuote & { error?: string };
			if (!quoteRes.ok) throw new Error(quote.error ?? "Could not get a quote");
			if (
				quote.wallet !== wallet ||
				quote.token !== token ||
				quote.usd !== usdValue
			)
				throw new Error("The quote does not match your order");

			const amountRaw = BigInt(quote.amountRaw);
			const destination = new PublicKey(quote.destination);
			const tx = new Transaction();
			tx.add(
				ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 20_000 }),
			);
			tx.add(
				new TransactionInstruction({
					programId: MEMO_PROGRAM,
					keys: [{ pubkey: publicKey, isSigner: true, isWritable: false }],
					data: Buffer.from(quote.memo, "utf8"),
				}),
			);
			const lamports = await connection.getBalance(publicKey, "confirmed");
			if (token === "SOL") {
				if (BigInt(lamports) < amountRaw + FEE_BUFFER_LAMPORTS)
					throw new Error(
						`Not enough mainnet SOL: this purchase needs ${Number(amountRaw) / 1e9} SOL plus a small network fee`,
					);
				tx.add(
					SystemProgram.transfer({
						fromPubkey: publicKey,
						toPubkey: destination,
						lamports: amountRaw,
					}),
				);
			} else {
				if (BigInt(lamports) < FEE_BUFFER_LAMPORTS)
					throw new Error("You need a little mainnet SOL for the network fee");
				const mint = new PublicKey(MAINNET_USDC_MINT);
				const source = getAssociatedTokenAddressSync(mint, publicKey);
				const balance = await connection
					.getTokenAccountBalance(source, "confirmed")
					.catch(() => null);
				if (!balance || BigInt(balance.value.amount) < amountRaw)
					throw new Error(
						`Not enough mainnet USDC: this purchase needs ${usd(usdValue)}`,
					);
				tx.add(
					createTransferCheckedInstruction(
						source,
						mint,
						destination,
						publicKey,
						amountRaw,
						USDC_DECIMALS,
					),
				);
			}
			const { blockhash, lastValidBlockHeight } =
				await connection.getLatestBlockhash("confirmed");
			tx.feePayer = publicKey;
			tx.recentBlockhash = blockhash;

			setStep("signing");
			const signed = await signTransaction(tx);
			setStep("sending");
			const signature = await connection.sendRawTransaction(
				signed.serialize(),
				{ maxRetries: 5 },
			);
			await connection
				.confirmTransaction(
					{ signature, blockhash, lastValidBlockHeight },
					"confirmed",
				)
				.catch(() => null);

			setStep("confirming");
			const deadline = Date.now() + CONFIRM_TIMEOUT_MS;
			while (true) {
				const res = await fetch(SALE_CONFIRM_PATH, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ quoteId: quote.id, signature }),
				});
				const data = await res.json();
				if (res.ok) {
					setReceipt({ signature, veSolv3: quote.veSolv3, usd: quote.usd });
					break;
				}
				if (
					!(res.status === 202 || res.status === 503) ||
					Date.now() > deadline
				)
					throw new Error(
						`${data.error ?? "The payment could not be verified"}. Your transaction: ${signature}. Contact the team with it if funds left your wallet.`,
					);
				await sleep(3000);
			}
			setStep("done");
			setAmount("");
			await queryClient.invalidateQueries({
				queryKey: ["presale-sale-status"],
			});
		} catch (e) {
			setStep("idle");
			const message = e instanceof Error ? e.message : String(e);
			setError(
				/reject|declin|cancel/i.test(message)
					? "You cancelled the payment in your wallet."
					: message,
			);
		}
	};

	const phase = status?.phase;
	return (
		<Stack
			gap="lg"
			py="xl"
			px={{ base: 16, md: 24 }}
			maw={1200}
			mx="auto"
			w="100%"
		>
			<FundNudge asset="choose" title="Pay from any chain" text="Get USDC or SOL from another chain to buy veSOLV3." />
			<Stack gap={6}>
				<Group gap="xs">
					<Badge variant="light" color="violet">
						Presale · Round 2
					</Badge>
					{phase && (
						<Badge
							variant="outline"
							color={phase === "OPEN" ? "green" : "gray"}
						>
							{phase === "NOT_CONFIGURED"
								? "Opening soon"
								: phase.replace("_", " ").toLowerCase()}
						</Badge>
					)}
				</Group>
				<Title order={1}>Buy veSOLV3 before launch</Title>
				<Text c="dimmed" maw={720}>
					veSOLV3 is SOLV3 locked permanently in the Solve3 vote-escrow: it
					votes on where emissions go and earns that pool&apos;s fees and
					bribes. Presale veSOLV3 costs a fixed ${SALE_PRICE_USD.toFixed(2)}{" "}
					each and is claimed as a lock in your wallet when Solve3 launches on
					mainnet.
				</Text>
			</Stack>

			<SimpleGrid cols={{ base: 1, md: 2 }} spacing="lg">
				<Paper withBorder p="lg" radius="md">
					<Stack gap="md">
						<Group justify="space-between" align="flex-end">
							<Stack gap={2}>
								<Text c="dimmed" fz="sm">
									Price
								</Text>
								<Text fw={700} fz={28}>
									${SALE_PRICE_USD.toFixed(2)}{" "}
									<Text span c="dimmed" fz="md">
										per veSOLV3
									</Text>
								</Text>
							</Stack>
							{config && phase === "UPCOMING" && (
								<Countdown to={config.startsAt} label="Opens in" />
							)}
							{config && phase === "OPEN" && (
								<Countdown to={config.endsAt} label="Ends in" />
							)}
						</Group>
						{config ? (
							<>
								<Progress
									value={cap ? Math.min(100, (sold / cap) * 100) : 0}
									size="lg"
									radius="xl"
								/>
								<Group justify="space-between">
									<Text fz="sm">
										<b>{usd(sold)}</b> raised of {usd(cap)}
									</Text>
									<Text fz="sm" c="dimmed">
										{status?.buyers ?? 0}{" "}
										{status?.buyers === 1 ? "buyer" : "buyers"}
									</Text>
								</Group>
								<Group justify="space-between">
									<Text fz="sm" c="dimmed">
										Per wallet: {usd(config.minUsd)} to{" "}
										{usd(config.maxUsdPerWallet)}
									</Text>
									<Text fz="sm" c="dimmed">
										Closes {new Date(config.endsAt).toLocaleString()}
									</Text>
								</Group>
							</>
						) : (
							<Text c="dimmed">
								The sale window and cap will be announced here shortly.
							</Text>
						)}
						{status?.wallet && status.wallet.purchasedUsd > 0 && (
							<Paper withBorder p="sm" radius="md">
								<Text fw={600}>Your allocation</Text>
								<Text fz="sm">
									{ve(status.wallet.veSolv3)} veSOLV3 for{" "}
									{usd(status.wallet.purchasedUsd)} · claim at mainnet launch
								</Text>
								{status.wallet.purchases.map((p) => (
									<Text key={p.signature} fz="xs" c="dimmed">
										{new Date(p.at).toLocaleString()} · {usd(p.usd)} in{" "}
										{p.token} ·{" "}
										<Anchor
											href={`https://solscan.io/tx/${p.signature}`}
											target="_blank"
											fz="xs"
										>
											payment
										</Anchor>
									</Text>
								))}
							</Paper>
						)}
					</Stack>
				</Paper>

				<Paper withBorder p="lg" radius="md">
					<Stack gap="md">
						<Text fw={600}>Buy</Text>
						<SegmentedControl
							value={token}
							onChange={(value) => setToken(value as SaleToken)}
							data={[
								{ value: "USDC", label: "Pay with USDC" },
								{ value: "SOL", label: "Pay with SOL" },
							]}
							disabled={busy}
						/>
						<NumberInput
							label="Amount (USD)"
							prefix="$"
							min={config?.minUsd ?? 1}
							max={limit || undefined}
							allowDecimal={false}
							thousandSeparator=","
							value={amount}
							onChange={setAmount}
							error={inputError}
							disabled={busy || phase !== "OPEN"}
						/>
						<Group justify="space-between">
							<Text c="dimmed" fz="sm">
								You receive
							</Text>
							<Text fw={700}>{ve(veFor)} veSOLV3</Text>
						</Group>
						{token === "SOL" && (
							<Text c="dimmed" fz="xs">
								The SOL amount is fixed from the live SOL price when you press
								Buy, and holds for two minutes.
							</Text>
						)}
						{!connected ? (
							<ConnectButton />
						) : (
							<Button
								size="lg"
								onClick={() => void buy()}
								loading={busy}
								disabled={
									phase !== "OPEN" ||
									!usdValue ||
									Boolean(inputError) ||
									!signTransaction
								}
							>
								{phase === "OPEN"
									? `Buy ${ve(veFor)} veSOLV3`
									: phase === "SOLD_OUT"
										? "Sold out"
										: phase === "ENDED"
											? "Presale ended"
											: "Not open yet"}
							</Button>
						)}
						{busy && (
							<Text fz="sm" role="status">
								{STEP_TEXT[step]}
							</Text>
						)}
						{error && (
							<Alert color="red" icon={<IconAlertTriangle size={18} />}>
								{error}
							</Alert>
						)}
						{receipt && (
							<Alert color="green" title="Purchase recorded">
								{ve(receipt.veSolv3)} veSOLV3 for {usd(receipt.usd)}.{" "}
								<Anchor
									href={`https://solscan.io/tx/${receipt.signature}`}
									target="_blank"
								>
									View payment
								</Anchor>
							</Alert>
						)}
						<Alert
							variant="light"
							color="gray"
							icon={<IconInfoCircle size={18} />}
						>
							<Stack gap={4}>
								<Text fz="xs">
									Payments are made on Solana mainnet with real funds, sent
									straight from your wallet to the Solve3 Treasury. Set your
									wallet to Mainnet before paying. You pay the network fee.
								</Text>
								<Text fz="xs">
									Your veSOLV3 is claimable when Solve3 launches on mainnet. It
									is a permanent lock: the SOLV3 inside it votes and earns, and
									leaving early is only possible through the protocol&apos;s
									exit, which charges a fee. Token values can fall; buy only
									what you can afford to lose, and check that buying is allowed
									where you live. Nothing here is investment advice.
								</Text>
							</Stack>
						</Alert>
					</Stack>
				</Paper>
			</SimpleGrid>
		</Stack>
	);
}
