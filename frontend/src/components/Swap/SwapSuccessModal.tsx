"use client";

import { useLingui } from "@lingui/react";
import { Modal } from "@mantine/core";
import { useState } from "react";
import { useCluster } from "@/providers/ClusterProvider";
import { ModalType } from "@/stores/modal";
import { useModal, useModalActions } from "@/stores/modal/ModalProvider";
import { useSwap } from "@/stores/swap/SwapProvider";
import { getExpolerUrl } from "@/utils/externalUrl";
import classes from "./SwapResult.module.css";
import type { SwapResultData } from "./swapResult";

const shorten = (signature: string) =>
	`${signature.slice(0, 6)}…${signature.slice(-6)}`;

const impactLabel = (impact: number | null) => {
	if (impact === null) return "—";
	const sign = Math.abs(impact) >= 0.01 ? (impact > 0 ? "-" : "+") : "";
	return `${sign}${Math.abs(impact).toFixed(2)}%`;
};

const feeLabel = (fee: number | undefined) =>
	fee === undefined ? "—" : `${Number(fee.toFixed(6))} SOL`;

export const SwapSuccessModal: React.FC = () => {
	const { network } = useCluster();
	const { i18n } = useLingui();
	const openModal = useModal((state) => state.openModal);
	const data = useModal((state) => state.data) as SwapResultData | undefined;
	const { closeModal } = useModalActions();
	const setTypedValue = useSwap((state) => state.actions.setTypedValue);
	const [copied, setCopied] = useState(false);

	const opened = openModal === ModalType.SWAP_SUCCESS && Boolean(data?.summary);
	const status = data?.status ?? "pending";
	const summary = data?.summary;

	const copy = async () => {
		if (!data?.signature) return;
		try {
			await navigator.clipboard.writeText(data.signature);
			setCopied(true);
			setTimeout(() => setCopied(false), 1500);
		} catch {
			// Clipboard can be unavailable (insecure context); the full signature is in the explorer link.
		}
	};

	// Done clears the form; Try again and Close keep the pair and amount.
	const primary = () => {
		if (status === "success") setTypedValue(0);
		closeModal();
	};

	const copy_ = {
		success: {
			title: i18n._("Swap successful"),
			subtitle: i18n._(
				"Your transaction is confirmed on Solana and the tokens are in your wallet.",
			),
			button: i18n._("Done"),
			glow: classes.glowSuccess,
		},
		pending: {
			title: i18n._("Confirming swap"),
			subtitle: i18n._(
				"Waiting for Solana to confirm your transaction. This usually takes a few seconds.",
			),
			button: i18n._("Close"),
			glow: classes.glowPending,
		},
		failed: {
			title: i18n._("Swap failed"),
			subtitle:
				data?.error ??
				i18n._(
					"The transaction did not go through and nothing was swapped. You can try again.",
				),
			button: i18n._("Try again"),
			glow: classes.glowFailed,
		},
	}[status];

	return (
		<Modal.Root
			lockScroll={false}
			opened={opened}
			onClose={closeModal}
			centered
			size={440}
			padding={0}
		>
			<Modal.Overlay
				color="#05050c"
				backgroundOpacity={0.76}
				blur={6}
			/>
			<Modal.Content
				radius={24}
				bg="transparent"
				style={{ overflow: "visible", boxShadow: "none" }}
				aria-labelledby="swap-result-title"
			>
				<div className={classes.content}>
				<div className={`${classes.glow} ${copy_.glow}`} />
				<div className={classes.body}>
					<div className={classes.top}>
						<img
							src="/assets/images/solve-logo.svg"
							alt=""
							height={30}
							width={26}
						/>
						<button
							type="button"
							className={classes.close}
							aria-label={i18n._("Close")}
							onClick={closeModal}
						>
							<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
								<path d="M6 6l12 12M18 6L6 18" />
							</svg>
						</button>
					</div>

					<div className={classes.head}>
						<div className={classes.icon}>
							{status === "success" && (
								<>
									<span className={classes.halo} />
									<span
										className={classes.ring}
										style={{ width: 84, height: 84, borderRadius: "50%", background: "radial-gradient(circle at 35% 30%, #7DE3FF, #58D7FF 55%, #685DF7)", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 0 40px rgba(88,215,255,0.5)" }}
									>
										<svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="#070711" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
											<path className={classes.check} d="M5 12.5l4.5 4.5L19 7.5" />
										</svg>
									</span>
								</>
							)}
							{status === "pending" && (
								<svg className={classes.spin} viewBox="0 0 84 84" width="84" height="84" fill="none" aria-hidden="true">
									<circle cx="42" cy="42" r="36" stroke="rgba(246,245,249,0.12)" strokeWidth="6" />
									<path d="M42 6a36 36 0 0 1 36 36" stroke="#8C84FF" strokeWidth="6" strokeLinecap="round" />
								</svg>
							)}
							{status === "failed" && (
								<span
									className={classes.ring}
									style={{ width: 84, height: 84, borderRadius: "50%", background: "rgba(255,107,129,0.14)", border: "2px solid #FF6B81", display: "flex", alignItems: "center", justifyContent: "center" }}
								>
									<svg viewBox="0 0 24 24" width="36" height="36" fill="none" stroke="#FF6B81" strokeWidth="3" strokeLinecap="round" aria-hidden="true">
										<path d="M12 6v8M12 18v.5" />
									</svg>
								</span>
							)}
						</div>
						<h2 id="swap-result-title" className={classes.title}>
							{copy_.title}
						</h2>
						<p className={classes.subtitle}>{copy_.subtitle}</p>
					</div>

					{summary && (
						<div className={classes.summary}>
							<div className={classes.line}>
								<span>{i18n._("You paid")}</span>
								<span className={classes.paid}>
									− {summary.paid} {summary.fromSymbol}
								</span>
							</div>
							<div className={classes.line}>
								<span>
									{status === "success"
										? i18n._("You received")
										: i18n._("You will receive")}
								</span>
								<span className={classes.got}>
									{status === "success" ? "+ " : ""}
									{status === "success" && data?.received
										? data.received
										: summary.got}{" "}
									{summary.toSymbol}
								</span>
							</div>
							<div className={classes.rule} />
							<div className={classes.line}>
								<span>{i18n._("Rate")}</span>
								<span>{rateLabel(summary)}</span>
							</div>
							<div className={classes.line}>
								<span>{i18n._("Network fee")}</span>
								<span>{feeLabel(data?.fee ?? summary.fee)}</span>
							</div>
							<div className={classes.line}>
								<span>{i18n._("Price impact")}</span>
								<span>{impactLabel(summary.impact)}</span>
							</div>
						</div>
					)}

					{data?.signature && (
						<div className={classes.tx}>
							<span>{i18n._("Transaction")}</span>
							<span className={classes.txRight}>
								<span className={classes.sig}>{shorten(data.signature)}</span>
								<button
									type="button"
									className={classes.copy}
									aria-label={copied ? i18n._("Copied") : i18n._("Copy signature")}
									onClick={copy}
								>
									{copied ? (
										<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
									) : (
										<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V6a2 2 0 0 1 2-2h9" /></svg>
									)}
								</button>
							</span>
						</div>
					)}

					<div className={classes.actions}>
						<button type="button" className={classes.primary} onClick={primary}>
							{copy_.button}
						</button>
						{data?.signature && (
							<a
								className={classes.explorer}
								href={getExpolerUrl(network, data.signature, "tx")}
								target="_blank"
								rel="noopener noreferrer"
							>
								{i18n._("View transaction on explorer")}
								<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M7 17L17 7M8 7h9v9" /></svg>
							</a>
						)}
					</div>
				</div>
				</div>
			</Modal.Content>
		</Modal.Root>
	);
};

const rateLabel = (summary: NonNullable<SwapResultData["summary"]>) => {
	const paid = Number(summary.paid.replace(/,/g, ""));
	const got = Number(summary.got.replace(/,/g, ""));
	if (!(paid > 0) || !(got > 0)) return "—";
	const rate = (got / paid).toLocaleString("en-US", { maximumFractionDigits: 6 });
	return `1 ${summary.fromSymbol} = ${rate} ${summary.toSymbol}`;
};
