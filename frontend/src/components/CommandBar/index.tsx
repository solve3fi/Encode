"use client";

import { useLingui } from "@lingui/react";
import { useWallet } from "@solana/wallet-adapter-react";
import {
	IconAlertTriangle,
	IconArrowRight,
	IconSparkles,
	IconX,
} from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
	getEpochClockState,
	VOTE_CUTOFF_SECONDS,
} from "@/components/Vote/epochClock";
import { INTENTS_ENABLED } from "@/configs/intents";
import { DEVNET_SOL, DEVNET_USDC, SOL, SOLVE } from "@/configs/tokens";
import { useAllTokenBalances } from "@/hooks/useCurrencyBalanace";
import { useNativeBalance } from "@/hooks/useNativeBalance";
import { useAllTokens } from "@/hooks/useToken";
import { parseCommand } from "@/lib/command/parse";
import {
	type CommandToken,
	type Plan,
	type PlanContext,
	planIntent,
} from "@/lib/command/plan";
import {
	allExamples,
	nearestExamples,
	suggestionsFor,
} from "@/lib/command/suggest";
import { useCluster } from "@/providers/ClusterProvider";
import { useLocks } from "@/stores/lock/hooks/useLocks";
import { ModalType } from "@/stores/modal";
import { useModalActions } from "@/stores/modal/ModalProvider";
import { useVoteConfig } from "@/stores/vote/hooks/useVoteConfig";
import classes from "./CommandBar.module.css";

const isTyping = (target: EventTarget | null) => {
	const el = target as HTMLElement | null;
	return Boolean(
		el &&
			(el.isContentEditable ||
				["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName)),
	);
};

/**
 * "Just Ask": a command bar on every page. You type what you want ("Swap 100 USDC for SOLV3", "Lock all my SOLV3"),
 * it shows what that means, and opens the page that finishes it, prefilled. It never signs or sends anything itself:
 * the destination page shows the quote or simulation and your wallet asks for approval there.
 */
export const CommandBar: React.FC = () => {
	const { i18n } = useLingui();
	const [open, setOpen] = useState(false);
	const [shortcut, setShortcut] = useState("Ctrl K");
	const triggerRef = useRef<HTMLButtonElement>(null);

	useEffect(() => {
		if (/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent))
			setShortcut("⌘K");
	}, []);

	useEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
				event.preventDefault();
				setOpen((value) => !value);
			} else if (event.key === "/" && !open && !isTyping(event.target)) {
				event.preventDefault();
				setOpen(true);
			}
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [open]);

	const close = useCallback(() => {
		setOpen(false);
		triggerRef.current?.focus();
	}, []);

	return (
		<>
			<button
				ref={triggerRef}
				type="button"
				className={classes.trigger}
				onClick={() => setOpen(true)}
				aria-haspopup="dialog"
				aria-label={i18n._("Just Ask: type what you want to do")}
			>
				<IconSparkles size={18} stroke={1.8} aria-hidden="true" />
				<span className={classes.triggerText}>{i18n._("Just Ask")}</span>
				<kbd className={classes.kbd}>{shortcut}</kbd>
			</button>
			{open &&
				typeof document !== "undefined" &&
				createPortal(<CommandPanel onClose={close} />, document.body)}
		</>
	);
};

/** Live data the planner needs. Mounted only while the panel is open, so it adds no requests to ordinary page views. */
const usePlanContext = (): PlanContext => {
	const { connected } = useWallet();
	const tokenMap = useAllTokens();
	const { data: rawBalances } = useAllTokenBalances();
	const { data: nativeSol } = useNativeBalance();
	const { data: locks } = useLocks();
	const { network } = useCluster();
	const vote = useVoteConfig(network);
	// Both only run while the panel is open (this hook is mounted with it), so ordinary page views add no requests.
	const solPrice = useQuery({
		queryKey: ["command-sol-price"],
		queryFn: async (): Promise<{ usd: number }> => {
			const response = await fetch("/api/sol-price");
			if (!response.ok) throw new Error("SOL price unavailable");
			return response.json();
		},
		staleTime: 60_000,
		retry: 1,
	});

	// useAllTokens returns a new object every render, so the list is keyed on its size instead.
	// biome-ignore lint/correctness/useExhaustiveDependencies: tokenMap's size is the stable key
	const tokens = useMemo(() => {
		const byAddress = new Map<string, CommandToken>();
		for (const t of [
			SOLVE,
			SOL,
			DEVNET_SOL,
			DEVNET_USDC,
			...Object.values(tokenMap ?? {}),
		]) {
			if (t?.address && t.symbol && !byAddress.has(t.address)) {
				byAddress.set(t.address, {
					symbol: t.symbol,
					address: t.address,
					decimals: t.decimals,
				});
			}
		}
		return [...byAddress.values()];
	}, [Object.keys(tokenMap ?? {}).length]);

	const balances = useMemo(() => {
		if (!connected || !rawBalances) return undefined;
		const out: Record<string, number> = {};
		for (const token of tokens) {
			const raw = rawBalances[token.address];
			if (raw !== undefined)
				out[token.address] = Number(raw.toString()) / 10 ** token.decimals;
		}
		if (typeof nativeSol === "number") out[SOL.address] = nativeSol;
		return out;
	}, [connected, rawBalances, nativeSol, tokens]);

	const epochData = vote.data;
	let epoch: NonNullable<PlanContext["facts"]>["epoch"] = null;
	if (epochData) {
		const chainNow = Math.floor(
			epochData.chainTime + (Date.now() - epochData.localTimeAtFetch) / 1000,
		);
		const state = getEpochClockState(epochData.nextEpochTime, chainNow);
		const target =
			state === "open"
				? epochData.nextEpochTime - VOTE_CUTOFF_SECONDS
				: epochData.nextEpochTime;
		epoch = {
			number: epochData.epoch.toNumber(),
			state,
			remainingSeconds:
				state === "settling" ? 0 : Math.max(0, target - chainNow),
		};
	}

	return {
		facts: { solUsd: solPrice.data?.usd ?? null, epoch },
		tokens,
		balances,
		locks:
			connected && locks
				? locks.map((lock) => ({
						id: lock.identifier.toNumber(),
						amount: Number(lock.tokenAmount.toString()) / 10 ** SOLVE.decimals,
					}))
				: undefined,
		connected,
		solv3Address: SOLVE.address,
		solAddress: SOL.address,
		intentsEnabled: INTENTS_ENABLED,
	};
};

const CommandPanel: React.FC<{ onClose: () => void }> = ({ onClose }) => {
	const { i18n } = useLingui();
	const router = useRouter();
	const [text, setText] = useState("");
	const inputRef = useRef<HTMLInputElement>(null);
	const ctx = usePlanContext();
	const { setOpenModal } = useModalActions();

	const plan: Plan | null = useMemo(() => {
		if (!text.trim()) return null;
		const parsed = parseCommand(text);
		if (parsed.ok) return planIntent(parsed.intent, ctx);
		// Offer the closest known commands first ("Did you mean"), then the parser's own hints.
		const near = nearestExamples(text, allExamples(INTENTS_ENABLED));
		return {
			ok: false,
			message: parsed.message,
			suggestions: near.length > 0 ? near : parsed.suggestions,
			didYouMean: near.length > 0,
		};
	}, [text, ctx]);

	const forYou = useMemo(() => suggestionsFor(ctx), [ctx]);

	useEffect(() => {
		inputRef.current?.focus();
		const previous = document.body.style.overflow;
		document.body.style.overflow = "hidden";
		return () => {
			document.body.style.overflow = previous;
		};
	}, []);

	const run = () => {
		if (!plan?.ok) return;
		router.push(plan.href);
		onClose();
	};

	const fill = (example: string) => {
		setText(example);
		inputRef.current?.focus();
	};

	return (
		<div className={classes.backdrop}>
			{/* Click outside the panel to close; Escape works too (handled on the dialog). */}
			<button
				type="button"
				className={classes.scrim}
				onClick={onClose}
				tabIndex={-1}
				aria-label={i18n._("Close")}
			/>
			<div
				role="dialog"
				aria-modal="true"
				aria-label={i18n._("Just Ask")}
				className={classes.panel}
				onKeyDown={(event) => {
					if (event.key === "Escape") {
						event.preventDefault();
						onClose();
					}
				}}
			>
				<form
					className={classes.inputRow}
					onSubmit={(event) => {
						event.preventDefault();
						run();
					}}
				>
					<IconSparkles
						size={20}
						stroke={1.8}
						className={classes.inputIcon}
						aria-hidden="true"
					/>
					<input
						ref={inputRef}
						className={classes.input}
						value={text}
						onChange={(event) => setText(event.currentTarget.value)}
						placeholder={i18n._(
							"Swap 100 USDC for SOLV3, lock all my SOLV3, claim all…",
						)}
						aria-label={i18n._("What do you want to do?")}
						aria-describedby="command-result"
						autoComplete="off"
						spellCheck={false}
						enterKeyHint="go"
					/>
					<button
						type="button"
						className={classes.close}
						onClick={onClose}
						aria-label={i18n._("Close")}
					>
						<IconX size={18} stroke={1.8} />
					</button>
				</form>

				<div id="command-result" className={classes.body} aria-live="polite">
					{!plan && (
						<>
							{forYou.length > 0 && (
								<Suggestions
									label={i18n._("For you")}
									items={forYou}
									onPick={fill}
								/>
							)}
							<Suggestions
								label={i18n._("Try")}
								items={allExamples(INTENTS_ENABLED)
									.filter((example) => !forYou.includes(example))
									.slice(0, 8)}
								onPick={fill}
							/>
						</>
					)}

					{plan && !plan.ok && (
						<>
							<p className={classes.message}>{plan.message}</p>
							{!ctx.connected && /wallet/i.test(plan.message) && (
								<div>
									<button
										type="button"
										className={classes.primary}
										onClick={() => {
											onClose();
											setOpenModal(ModalType.WALLET);
										}}
									>
										{i18n._("Connect wallet")}
									</button>
								</div>
							)}
							{plan.suggestions.length > 0 && (
								<Suggestions
									label={plan.didYouMean ? i18n._("Did you mean") : undefined}
									items={plan.suggestions}
									onPick={fill}
								/>
							)}
						</>
					)}

					{plan?.ok && (
						<div className={classes.card}>
							<strong className={classes.title}>{plan.title}</strong>
							{plan.lines.length > 0 && (
								<ul className={classes.lines}>
									{plan.lines.map((line) => (
										<li key={line}>{line}</li>
									))}
								</ul>
							)}
							{plan.warnings.map((warning) => (
								<p key={warning} className={classes.warning}>
									<IconAlertTriangle
										size={16}
										stroke={1.8}
										aria-hidden="true"
									/>
									<span>{warning}</span>
								</p>
							))}
							<div className={classes.actions}>
								<button type="button" className={classes.primary} onClick={run}>
									{plan.cta}
									<IconArrowRight size={17} stroke={1.8} aria-hidden="true" />
								</button>
								<span className={classes.hint}>{i18n._("Enter")} ↵</span>
							</div>
							<p className={classes.fine}>
								{plan.answer
									? i18n._("Just information. Nothing is sent or signed.")
									: i18n._(
											"Nothing is sent yet. You review and sign on the next page.",
										)}
							</p>
						</div>
					)}
				</div>
			</div>
		</div>
	);
};

const Suggestions: React.FC<{
	label?: string;
	items: string[];
	onPick: (text: string) => void;
}> = ({ label, items, onPick }) => (
	<div className={classes.suggestions}>
		{label && <span className={classes.suggestLabel}>{label}</span>}
		<div className={classes.chips}>
			{items.map((item) => (
				<button
					key={item}
					type="button"
					className={classes.chip}
					onClick={() => onPick(item)}
				>
					{item}
				</button>
			))}
		</div>
	</div>
);
