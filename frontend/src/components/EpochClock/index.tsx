"use client";

import { Popover } from "@mantine/core";
import { useEffect, useMemo, useRef, useState } from "react";
import { formatDuration } from "@/lib/format";
import { useCluster } from "@/providers/ClusterProvider";
import { useVoteConfig } from "@/stores/vote/hooks/useVoteConfig";
import {
	getEpochClockState,
	VOTE_CUTOFF_SECONDS,
	type EpochClockState,
} from "@/components/Vote/epochClock";
import classes from "./EpochClock.module.css";

export type EpochClockVariant = "hero" | "bar" | "inline";

type EpochClockProps = {
	variant?: EpochClockVariant;
	className?: string;
};

const stateCopy: Record<
	EpochClockState,
	{ label: string; countdownLabel: string; detail: string }
> = {
	open: {
		label: "Voting open",
		countdownLabel: "until final vote",
		detail: "Votes can be changed until the five-minute cutoff.",
	},
	"final-hour": {
		label: "Voting closed",
		countdownLabel: "until epoch end",
		detail: "Final weights are fixed while the epoch reaches its boundary.",
	},
	settling: {
		label: "Settlement pending",
		countdownLabel: "keeper reconciling",
		detail: "The admin-authorized keeper is rolling the epoch and funding voted gauges.",
	},
	settled: {
		label: "Epoch settled",
		countdownLabel: "new epoch open",
		detail: "The new epoch is active and its voting window is open.",
	},
};

const formatUtc = (unixSeconds: number) =>
	new Intl.DateTimeFormat("en-GB", {
		timeZone: "UTC",
		weekday: "short",
		day: "2-digit",
		month: "short",
		hour: "2-digit",
		minute: "2-digit",
		hourCycle: "h23",
	}).format(new Date(unixSeconds * 1_000));

const formatLocal = (unixSeconds: number) =>
	new Intl.DateTimeFormat(undefined, {
		weekday: "short",
		hour: "numeric",
		minute: "2-digit",
		timeZoneName: "short",
	}).format(new Date(unixSeconds * 1_000));

export const EpochClock = ({ variant = "inline", className = "" }: EpochClockProps) => {
	const { network } = useCluster();
	const query = useVoteConfig(network);
	const [localNow, setLocalNow] = useState(0);
	const [settledEpoch, setSettledEpoch] = useState<number | null>(null);
	const previousEpoch = useRef<number | null>(null);
	const epochNumber = query.data?.epoch.toNumber() ?? null;

	useEffect(() => {
		const tick = () => setLocalNow(Date.now());
		tick();
		const interval = window.setInterval(tick, 1_000);
		return () => window.clearInterval(interval);
	}, []);

	useEffect(() => {
		if (epochNumber === null) return;
		if (previousEpoch.current !== null && epochNumber > previousEpoch.current) {
			setSettledEpoch(epochNumber);
		}
		previousEpoch.current = epochNumber;
	}, [epochNumber]);

	useEffect(() => {
		if (settledEpoch === null) return;
		const timeout = window.setTimeout(() => setSettledEpoch(null), 5_000);
		return () => window.clearTimeout(timeout);
	}, [settledEpoch]);

	const snapshot = useMemo(() => {
		const data = query.data;
		if (!data || !localNow || epochNumber === null) return null;
		const chainNow = Math.floor(
			data.chainTime + (localNow - data.localTimeAtFetch) / 1_000,
		);
		const cutoff = data.nextEpochTime - VOTE_CUTOFF_SECONDS;
		const justSettled = settledEpoch === epochNumber;
		const state = getEpochClockState(data.nextEpochTime, chainNow, justSettled);
		const target = state === "open" ? cutoff : data.nextEpochTime;
		const remaining = state === "settling" || state === "settled"
			? 0
			: Math.max(0, target - chainNow);
		const epochLength = Math.max(1, data.nextEpochTime - data.epochStartTime);
		const progress = Math.min(
			100,
			Math.max(0, ((chainNow - data.epochStartTime) / epochLength) * 100),
		);
		const cutoffProgress = ((cutoff - data.epochStartTime) / epochLength) * 100;
		return {
			state,
			chainNow,
			cutoff,
			end: data.nextEpochTime,
			remaining,
			progress,
			cutoffProgress,
		};
	}, [epochNumber, localNow, query.data, settledEpoch]);

	if (query.isLoading || !snapshot || epochNumber === null) {
		return (
			<div className={`${classes.loading} ${classes[variant]} ${className}`}>
				<span>Chain clock</span>
				<strong>{query.isError ? "Unavailable" : "Synchronizing"}</strong>
			</div>
		);
	}

	const copy = stateCopy[snapshot.state];
	const countdown = formatDuration(snapshot.remaining);
	const stateClass = classes[snapshot.state];
	const announcement = `${copy.label}. ${copy.countdownLabel}.`;

	if (variant === "hero") {
		return (
			<div className={`${classes.hero} ${stateClass} ${className}`} data-state={snapshot.state}>
				<div className={classes.heroOrbit}>
					<span className={classes.kicker}>Epoch {epochNumber} / {copy.label}</span>
					<strong className={classes.heroTime}>{snapshot.state === "settling" ? "Pending" : snapshot.state === "settled" ? "Settled" : countdown}</strong>
					<span className={classes.heroLabel}>{copy.countdownLabel}</span>
				</div>
				<div className={classes.track} aria-hidden="true">
					<span className={classes.trackProgress} style={{ width: `${snapshot.progress}%` }} />
					<span className={classes.finalWindow} style={{ left: `${snapshot.cutoffProgress}%` }} />
					<span className={classes.cutoffMarker} style={{ left: `${snapshot.cutoffProgress}%` }} />
				</div>
				<div className={classes.heroDates}>
					<span><small>Final vote</small>{formatUtc(snapshot.cutoff)} UTC</span>
					<span><small>Epoch boundary</small>{formatUtc(snapshot.end)} UTC</span>
				</div>
				<p className={classes.detail}>{copy.detail}</p>
				<span className={classes.srOnly} aria-live="polite">{announcement}</span>
			</div>
		);
	}

	if (variant === "bar") {
		return (
			<Popover width={320} position="bottom-end" shadow="md" withArrow>
				<Popover.Target>
					<button type="button" className={`${classes.bar} ${stateClass} ${className}`} data-state={snapshot.state}>
						<span className={classes.barCopy}>
							<small>Epoch {epochNumber} · {copy.label}</small>
							<strong>
								{snapshot.state === "settling"
									? "Pending"
									: snapshot.state === "settled"
										? "Settled"
										: countdown}
								<span className={classes.barSuffix}> {copy.countdownLabel}</span>
							</strong>
						</span>
					</button>
				</Popover.Target>
				<Popover.Dropdown className={classes.popover}>
					<div className={classes.popoverHeading}><span className={classes.stateDot} /><strong>{copy.label}</strong></div>
					<p>{copy.detail}</p>
					<dl>
						<div><dt>Final vote</dt><dd>{formatUtc(snapshot.cutoff)} UTC</dd></div>
						<div><dt>Epoch end</dt><dd>{formatUtc(snapshot.end)} UTC</dd></div>
						<div><dt>Your time</dt><dd>{formatLocal(snapshot.end)}</dd></div>
					</dl>
				</Popover.Dropdown>
				<span className={classes.srOnly} aria-live="polite">{announcement}</span>
			</Popover>
		);
	}

	return (
		<div className={`${classes.inline} ${stateClass} ${className}`} data-state={snapshot.state}>
			<span className={classes.stateDot} />
			<span><small>Epoch {epochNumber} · {copy.label}</small><strong>{snapshot.state === "settling" ? "Pending" : snapshot.state === "settled" ? "Settled" : countdown}</strong></span>
			<span className={classes.inlineLabel}>{copy.countdownLabel}</span>
			<span className={classes.srOnly} aria-live="polite">{announcement}</span>
		</div>
	);
};
