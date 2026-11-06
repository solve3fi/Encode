"use client";

import {
	Alert,
	Badge,
	Button,
	Group,
	NumberInput,
	Paper,
	SimpleGrid,
	Stack,
	Table,
	Text,
	TextInput,
	Title,
} from "@mantine/core";
import { useState } from "react";
import {
	SALE_ADMIN_PATH,
	SALE_ADMIN_PUBLISH_ACTION,
	SALE_ADMIN_READ_ACTION,
	SALE_ADMIN_SAVE_ACTION,
	SALE_PRICE_USD,
	type SaleStatus,
	validateSaleConfig,
} from "@/configs/presaleSale";
import { useAdminAuth } from "@/hooks/useAdminAuth";

type Purchase = {
	signature: string;
	wallet: string;
	token: string;
	usd: number;
	veSolv3Raw: string;
	amountRaw: string;
	at: string;
};
type Ledger = {
	status: SaleStatus;
	configUpdatedBy: string | null;
	configUpdatedAt: string | null;
	purchases: Purchase[];
};

// <input type="datetime-local"> works in local time without a zone; the ledger stores ISO UTC.
const toLocalInput = (iso: string) => {
	const d = new Date(iso);
	return new Date(d.getTime() - d.getTimezoneOffset() * 60_000)
		.toISOString()
		.slice(0, 16);
};
const short = (value: string) => `${value.slice(0, 4)}…${value.slice(-4)}`;
const usd = (value: number) => `$${value.toLocaleString()}`;

/** Admin > Presale: sale settings (signed by an admin wallet) and the purchase ledger with CSV export. */
export function AdminPresaleSale() {
	const { sign } = useAdminAuth();
	const [busy, setBusy] = useState<"load" | "save" | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [notice, setNotice] = useState<string | null>(null);
	const [ledger, setLedger] = useState<Ledger | null>(null);
	const [startsAt, setStartsAt] = useState("");
	const [endsAt, setEndsAt] = useState("");
	const [hardCapUsd, setHardCapUsd] = useState<number | string>("");
	const [minUsd, setMinUsd] = useState<number | string>("");
	const [maxUsdPerWallet, setMaxUsdPerWallet] = useState<number | string>("");
	const [treasury, setTreasury] = useState("");

	const post = async (body: unknown) => {
		const response = await fetch(SALE_ADMIN_PATH, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
		});
		const data = await response.json().catch(() => ({}));
		if (!response.ok)
			throw new Error(data.error ?? `Request failed (${response.status})`);
		return data;
	};

	const load = async (quiet = false) => {
		setBusy("load");
		setError(null);
		if (!quiet) setNotice(null);
		try {
			const data = (await post({
				...(await sign(SALE_ADMIN_READ_ACTION, {})),
				action: "read",
			})) as Ledger;
			setLedger(data);
			const config = data.status.config;
			if (config) {
				setStartsAt(toLocalInput(config.startsAt));
				setEndsAt(toLocalInput(config.endsAt));
				setHardCapUsd(config.hardCapUsd);
				setMinUsd(config.minUsd);
				setMaxUsdPerWallet(config.maxUsdPerWallet);
				setTreasury(config.treasury);
			}
		} catch (e) {
			setError(e instanceof Error ? e.message : "Could not load the ledger");
		} finally {
			setBusy(null);
		}
	};

	const save = async () => {
		setError(null);
		setNotice(null);
		const validated = validateSaleConfig({
			startsAt: startsAt ? new Date(startsAt).toISOString() : "",
			endsAt: endsAt ? new Date(endsAt).toISOString() : "",
			hardCapUsd: Number(hardCapUsd),
			minUsd: Number(minUsd),
			maxUsdPerWallet: Number(maxUsdPerWallet),
			treasury: treasury.trim(),
		});
		if ("error" in validated) {
			setError(validated.error);
			return;
		}
		setBusy("save");
		try {
			await post({
				...(await sign(SALE_ADMIN_SAVE_ACTION, validated.config)),
				action: "save",
				config: validated.config,
			});
			setNotice("Settings saved. The sale page uses them immediately.");
			await load(true);
		} catch (e) {
			setError(e instanceof Error ? e.message : "Could not save the settings");
		} finally {
			setBusy(null);
		}
	};

	const exportCsv = () => {
		if (!ledger) return;
		const rows = [
			["at", "wallet", "token", "usd", "veSolv3", "amountRaw", "signature"],
			...ledger.purchases.map((p) => [
				p.at,
				p.wallet,
				p.token,
				String(p.usd),
				String(Number(p.veSolv3Raw) / 1e9),
				p.amountRaw,
				p.signature,
			]),
		];
		const csv = rows
			.map((row) =>
				row.map((cell) => `"${cell.replaceAll('"', '""')}"`).join(","),
			)
			.join("\n");
		const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
		const link = document.createElement("a");
		link.href = url;
		link.download = `presale-round2-${new Date().toISOString().slice(0, 10)}.csv`;
		link.click();
		URL.revokeObjectURL(url);
	};

	// One row per wallet in the columns the Friends & Family claim upload expects (Admin > Airdrop/Presale upload:
	// solana_address, amount_usd, ve_solv3_amount; a wallet may appear only once), so round 2 can be merged into the
	// claim list when the sale ends.
	const exportClaimList = () => {
		if (!ledger) return;
		const byWallet = new Map<string, { usd: number; raw: bigint }>();
		for (const p of ledger.purchases) {
			const row = byWallet.get(p.wallet) ?? { usd: 0, raw: BigInt(0) };
			row.usd += p.usd;
			row.raw += BigInt(p.veSolv3Raw);
			byWallet.set(p.wallet, row);
		}
		const ve = (raw: bigint) => {
			const unit = BigInt(1_000_000_000);
			const fraction = (raw % unit)
				.toString()
				.padStart(9, "0")
				.replace(/0+$/, "");
			return fraction ? `${raw / unit}.${fraction}` : `${raw / unit}`;
		};
		const csv = [
			"solana_address,amount_usd,ve_solv3_amount",
			...[...byWallet]
				.sort(([a], [b]) => a.localeCompare(b))
				.map(([wallet, row]) => `${wallet},${row.usd},${ve(row.raw)}`),
		].join("\n");
		const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
		const link = document.createElement("a");
		link.href = url;
		link.download = `presale-round2-claim-list-${new Date().toISOString().slice(0, 10)}.csv`;
		link.click();
		URL.revokeObjectURL(url);
	};

	const publishClaims = async () => {
		if (
			!window.confirm(
				"Publish the round-2 claim list? Buyers can then claim their veSOLV3 on /presale once claims are open. You can republish until the first round-2 claim starts.",
			)
		)
			return;
		setError(null);
		setNotice(null);
		setBusy("save");
		try {
			const result = (await post({
				...(await sign(SALE_ADMIN_PUBLISH_ACTION, {})),
				action: "publish-claims",
			})) as { wallets: number; totalUsd: number };
			setNotice(
				`Round-2 claim list published: ${result.wallets} wallets, ${usd(result.totalUsd)}.`,
			);
		} catch (e) {
			setError(
				e instanceof Error ? e.message : "Could not publish the claim list",
			);
		} finally {
			setBusy(null);
		}
	};

	const status = ledger?.status;
	return (
		<Stack gap="lg">
			<Stack gap={4}>
				<Title order={3}>Presale round 2</Title>
				<Text c="dimmed" fz="sm">
					veSOLV3 at a fixed ${SALE_PRICE_USD.toFixed(2)}, paid in mainnet USDC
					or SOL straight to the Treasury below and claimed at mainnet launch.
					The sale stays closed until these settings are saved.
				</Text>
			</Stack>
			{error && <Alert color="red">{error}</Alert>}
			{notice && <Alert color="green">{notice}</Alert>}

			<Paper withBorder p="md">
				<Stack gap="sm">
					<SimpleGrid cols={{ base: 1, sm: 2 }}>
						<TextInput
							label="Starts (your local time)"
							type="datetime-local"
							value={startsAt}
							onChange={(e) => setStartsAt(e.currentTarget.value)}
						/>
						<TextInput
							label="Ends (your local time)"
							type="datetime-local"
							value={endsAt}
							onChange={(e) => setEndsAt(e.currentTarget.value)}
						/>
						<NumberInput
							label="Hard cap (total raise)"
							prefix="$"
							min={1}
							allowDecimal={false}
							thousandSeparator=","
							value={hardCapUsd}
							onChange={setHardCapUsd}
						/>
						<NumberInput
							label="Minimum per purchase"
							prefix="$"
							min={1}
							allowDecimal={false}
							thousandSeparator=","
							value={minUsd}
							onChange={setMinUsd}
						/>
						<NumberInput
							label="Maximum per wallet"
							prefix="$"
							min={1}
							allowDecimal={false}
							thousandSeparator=","
							value={maxUsdPerWallet}
							onChange={setMaxUsdPerWallet}
						/>
						<TextInput
							label="Treasury (mainnet wallet that receives USDC and SOL)"
							value={treasury}
							onChange={(e) => setTreasury(e.currentTarget.value)}
						/>
					</SimpleGrid>
					<Text c="dimmed" fz="xs">
						USDC is paid into the Treasury&apos;s USDC token account, which must
						already exist on mainnet. Until it does, buyers can only pay with
						SOL.
					</Text>
					<Group>
						<Button
							onClick={() => void save()}
							loading={busy === "save"}
							disabled={busy !== null}
						>
							Save settings
						</Button>
						<Button
							variant="light"
							onClick={() => void load()}
							loading={busy === "load"}
							disabled={busy !== null}
						>
							{ledger ? "Refresh ledger" : "Load settings and ledger"}
						</Button>
						{ledger && ledger.purchases.length > 0 && (
							<>
								<Button variant="subtle" onClick={exportCsv}>
									Export purchases (CSV)
								</Button>
								<Button variant="subtle" onClick={exportClaimList}>
									Export claim list (round 2)
								</Button>
								<Button
									variant="light"
									color="green"
									onClick={() => void publishClaims()}
									disabled={
										busy !== null ||
										!(
											ledger.status.phase === "ENDED" ||
											ledger.status.phase === "SOLD_OUT"
										)
									}
								>
									Publish round-2 claims
								</Button>
							</>
						)}
					</Group>
				</Stack>
			</Paper>

			{status && (
				<Paper withBorder p="md">
					<Group gap="xl">
						<Badge variant="light">{status.phase.replaceAll("_", " ")}</Badge>
						<Text>
							Sold <b>{usd(status.soldUsd)}</b>
							{status.config ? ` of ${usd(status.config.hardCapUsd)}` : ""}
						</Text>
						<Text>
							Held by open quotes <b>{usd(status.reservedUsd)}</b>
						</Text>
						<Text>
							Buyers <b>{status.buyers}</b>
						</Text>
						<Text>
							Left <b>{usd(status.remainingUsd)}</b>
						</Text>
					</Group>
					{ledger?.configUpdatedAt && (
						<Text c="dimmed" fz="xs" mt="xs">
							Settings last saved{" "}
							{new Date(ledger.configUpdatedAt).toLocaleString()} by{" "}
							{short(ledger.configUpdatedBy ?? "")}
						</Text>
					)}
				</Paper>
			)}

			{ledger && (
				<Table.ScrollContainer minWidth={640}>
					<Table striped>
						<Table.Thead>
							<Table.Tr>
								<Table.Th>Time</Table.Th>
								<Table.Th>Wallet</Table.Th>
								<Table.Th>Paid with</Table.Th>
								<Table.Th ta="right">USD</Table.Th>
								<Table.Th ta="right">veSOLV3</Table.Th>
								<Table.Th>Payment</Table.Th>
							</Table.Tr>
						</Table.Thead>
						<Table.Tbody>
							{ledger.purchases.length === 0 ? (
								<Table.Tr>
									<Table.Td colSpan={6}>
										<Text c="dimmed">No purchases yet.</Text>
									</Table.Td>
								</Table.Tr>
							) : (
								ledger.purchases.map((p) => (
									<Table.Tr key={p.signature}>
										<Table.Td>{new Date(p.at).toLocaleString()}</Table.Td>
										<Table.Td>{short(p.wallet)}</Table.Td>
										<Table.Td>{p.token}</Table.Td>
										<Table.Td ta="right">{usd(p.usd)}</Table.Td>
										<Table.Td ta="right">
											{(Number(p.veSolv3Raw) / 1e9).toLocaleString()}
										</Table.Td>
										<Table.Td>
											<a
												href={`https://solscan.io/tx/${p.signature}`}
												target="_blank"
												rel="noreferrer"
											>
												{short(p.signature)}
											</a>
										</Table.Td>
									</Table.Tr>
								))
							)}
						</Table.Tbody>
					</Table>
				</Table.ScrollContainer>
			)}
		</Stack>
	);
}
