"use client";

import { DecimalUtil } from "@solve3fi/common";
import type { Solve } from "@solve3fi/sdk";
import { useQuery } from "@tanstack/react-query";
import { SOLVE } from "@/configs/tokens";
import { useAllTokens } from "@/hooks/useToken";
import {
	getEpochPDA,
	getGaugePDA,
	getProtocolPDA,
	getVaultPDA,
	useVesolveProgram,
	vesolveAccount,
} from "@/hooks/useVesolveProgram";
import { useCluster } from "@/providers/ClusterProvider";
import styles from "./PoolDetails.module.css";

export function PoolEpochHistory({
	pool,
	epoch,
}: {
	pool: Solve;
	epoch: number;
}) {
	const { network } = useCluster();
	const program = useVesolveProgram();
	const tokens = useAllTokens();
	const gauge = getGaugePDA(getProtocolPDA()[0], pool.getAddress())[0];
	const query = useQuery({
		queryKey: ["pool-epoch-history", network, gauge.toBase58(), epoch],
		enabled: epoch > 1,
		staleTime: 60_000,
		queryFn: async () => {
			const numbers = Array.from(
				{ length: Math.min(4, epoch - 1) },
				(_, i) => epoch - 1 - i,
			);
			const [epochs, vaults] = await Promise.all([
				vesolveAccount
					.epoch(program)
					.fetchMultiple(numbers.map((number) => getEpochPDA(number)[0])),
				vesolveAccount
					.vault(program)
					.fetchMultiple(
						numbers.map((number) => getVaultPDA(number, gauge)[0]),
					),
			]);
			return numbers.map((number, i) => ({
				number,
				vote: epochs[i],
				vault: vaults[i],
			}));
		},
	});
	const a = pool.getTokenAInfo();
	const b = pool.getTokenBInfo();
	const tokenLabel = (mint: string) =>
		tokens[mint]?.symbol ?? mint.slice(0, 6) + "…";
	const format = (
		raw: Parameters<typeof DecimalUtil.fromBN>[0],
		decimals: number,
	) => DecimalUtil.fromBN(raw, decimals).toSignificantDigits(6).toString();
	return (
		<section aria-label="Pool epoch history">
			<h3>Completed epochs for this pool</h3>
			<p>
				Recorded votes and funded voter rewards. Fees and incentives are shown
				in their original tokens.
			</p>
			{query.isError ? (
				<p role="status">
					Pool history is unavailable.{" "}
					<button type="button" onClick={() => void query.refetch()}>
						Retry
					</button>
				</p>
			) : !query.data ? (
				<p>Reading pool history…</p>
			) : (
				query.data.map(({ number, vote, vault }) => {
					const weight = vote?.gaugeWeights.find((entry) =>
						entry.gauge.equals(gauge),
					)?.weight;
					const incentives = vote?.bribes.filter(
						(entry) => entry.gauge.equals(gauge) && !entry.amount.isZero(),
					);
					return (
						<dl className={styles.metrics} key={number}>
							<div>
								<dt>Epoch {number} · voting weight</dt>
								<dd>
									{vote
										? (weight ? format(weight, SOLVE.decimals) : "0") +
											" veSOLV3"
										: "—"}
								</dd>
							</div>
							<div>
								<dt>Recorded voter fees</dt>
								<dd>
									{vault
										? `${format(vault.poolRewardsA, a.decimals)} ${tokenLabel(a.mint.toString())} + ${format(vault.poolRewardsB, b.decimals)} ${tokenLabel(b.mint.toString())}`
										: "—"}
								</dd>
							</div>
							<div>
								<dt>Funded voting incentives</dt>
								<dd>
									{incentives
										? incentives
												.map(({ tokenMint, amount }) => {
													const mint = tokenMint.toBase58();
													const decimals = tokens[mint]?.decimals;
													return decimals === undefined
														? `${tokenLabel(mint)} amount unavailable`
														: `${format(amount, decimals)} ${tokenLabel(mint)}`;
												})
												.join(" + ") || "None recorded"
										: "—"}
								</dd>
							</div>
						</dl>
					);
				})
			)}
		</section>
	);
}
