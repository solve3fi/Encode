"use client";

import { DecimalUtil } from "@solve3fi/common";
import { useQuery } from "@tanstack/react-query";
import { SOLVE } from "@/configs/tokens";
import {
	getEpochEmissionPDA,
	getEpochPDA,
	useVesolveProgram,
	vesolveAccount,
} from "@/hooks/useVesolveProgram";
import { useCluster } from "@/providers/ClusterProvider";
import styles from "./EpochOverview.module.css";

export function EpochHistory({ currentEpoch }: { currentEpoch: number }) {
	const { network } = useCluster();
	const program = useVesolveProgram();
	const query = useQuery({
		queryKey: ["completed-epoch-history", network, currentEpoch],
		enabled: currentEpoch > 1,
		staleTime: 60_000,
		queryFn: async () => {
			const epochs = Array.from(
				{ length: Math.min(4, currentEpoch - 1) },
				(_, i) => currentEpoch - 1 - i,
			);
			const [votes, emissions] = await Promise.all([
				vesolveAccount
					.epoch(program)
					.fetchMultiple(epochs.map((epoch) => getEpochPDA(epoch)[0])),
				vesolveAccount
					.epochEmission(program)
					.fetchMultiple(
						epochs.map((epoch) => getEpochEmissionPDA(epoch + 1)[0]),
					),
			]);
			return epochs.map((epoch, i) => ({
				epoch,
				votes: votes[i],
				emissions: emissions[i],
			}));
		},
	});
	const display = (raw: Parameters<typeof DecimalUtil.fromBN>[0]) =>
		DecimalUtil.fromBN(raw, SOLVE.decimals)
			.toNumber()
			.toLocaleString("en-US", { maximumFractionDigits: 2 });
	return (
		<section aria-label="Completed epoch history">
			<div className={styles.caption}>
				<h3>Completed voting epochs</h3>
			</div>
			<p>
				Each row pairs a completed vote with the next epoch’s recorded gauge
				funding. Funding is separate from rewards users have claimed.
			</p>
			{query.isError ? (
				<p role="status">
					Epoch history is unavailable.{" "}
					<button type="button" onClick={() => void query.refetch()}>
						Retry
					</button>
				</p>
			) : currentEpoch <= 1 ? (
				<p>No completed voting epochs available.</p>
			) : !query.data ? (
				<p>Reading completed epochs…</p>
			) : (
				query.data.map(({ epoch, votes, emissions }) => (
					<article className={styles.gauge} key={epoch}>
						<div>
							<b>Epoch {epoch}</b>
							<small>Completed vote</small>
						</div>
						<div>
							<b>
								{votes ? display(votes.totalVotingPower) + " veSOLV3" : "—"}
							</b>
							<small>Voting weight cast</small>
						</div>
						<div>
							<b>
								{votes
									? votes.gaugeWeights.filter((entry) => !entry.weight.isZero())
											.length
									: "—"}
							</b>
							<small>Gauges supported</small>
						</div>
						<div>
							<b>
								{emissions
									? display(emissions.distributedToGauges) + " SOLV3"
									: "—"}
							</b>
							<small>Funded to gauges in epoch {epoch + 1}</small>
						</div>
					</article>
				))
			)}
		</section>
	);
}
