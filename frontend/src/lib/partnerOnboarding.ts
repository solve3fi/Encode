// Where each partner stands on the way to their private space, and what the admin has to do next.
// Pure and alias-free so it can be tested directly. Gauge status numbers follow the on-chain enum:
// 0 created, 1 pending activation, 2 active, 3 pending removal, 4 removed; undefined = no gauge.

export type OnboardingStepKey =
	| "request"
	| "pool"
	| "gauge"
	| "space"
	| "spacepool"
	| "link"
	| "voter"
	| "accelerator";

export type OnboardingTarget =
	| "token-requests"
	| "add-gauge"
	| "partner-spaces"
	| "controls"
	| null;

export type OnboardingInput = {
	requestStatus: "pending" | "approved" | "rejected";
	/** The partner's pool, if one trades their token; gaugeStatus undefined means it has no gauge. */
	pool: { gaugeStatus: number | undefined } | null;
	space: {
		status: "active" | "revoked";
		walletCount: number;
		linkSentAt: number | null;
	} | null;
	/**
	 * Optional checks, supplied once they are known (undefined = not known, so the step is left out):
	 * the space's recorded pool is a pool of this token that has a gauge; the shared partner voter is flagged
	 * on chain (one time for every partner); the partner is enrolled in the Accelerator with that pool.
	 */
	spacePoolOk?: boolean;
	partnerVoterFlagged?: boolean;
	accelerator?: boolean;
};

export type OnboardingStep = {
	key: OnboardingStepKey;
	label: string;
	done: boolean;
	/** A reminder that never holds the partner back from being finished. */
	optional?: boolean;
};

export type OnboardingResult = {
	steps: OnboardingStep[];
	/** The first unfinished step, or null when the partner is fully onboarded (or rejected). */
	next: {
		key: OnboardingStepKey;
		text: string;
		/** True when the move is the admin's; false when the admin is waiting on the partner. */
		needsAction: boolean;
		target: OnboardingTarget;
		button: string | null;
	} | null;
	state: "in-progress" | "done" | "rejected" | "revoked";
	gaugeActive: boolean;
};

export function onboardingProgress(input: OnboardingInput): OnboardingResult {
	const { requestStatus, pool, space, spacePoolOk, partnerVoterFlagged, accelerator } = input;
	const activeSpace = space?.status === "active" ? space : null;
	const hasGauge = Boolean(pool) && pool?.gaugeStatus !== undefined;
	const steps: OnboardingStep[] = [
		{ key: "request", label: "Token approved", done: requestStatus === "approved" },
		{ key: "pool", label: "Pool live", done: Boolean(pool) },
		{ key: "gauge", label: "Gauge added", done: hasGauge },
		{ key: "space", label: "Space created", done: Boolean(activeSpace) },
		...(spacePoolOk === undefined
			? []
			: [{ key: "spacepool" as const, label: "Space pool is the gauged pool", done: Boolean(activeSpace) && spacePoolOk }]),
		{ key: "link", label: "Link sent", done: Boolean(activeSpace?.linkSentAt) },
		...(partnerVoterFlagged === undefined
			? []
			: [{ key: "voter" as const, label: "Partner voter flagged (once)", done: partnerVoterFlagged }]),
		...(accelerator === undefined
			? []
			: [{ key: "accelerator" as const, label: "Accelerator enrolled (if they asked)", done: accelerator, optional: true }]),
	];
	const gaugeActive = pool?.gaugeStatus === 2;

	if (requestStatus === "rejected")
		return { steps, next: null, state: "rejected", gaugeActive };
	if (space && space.status === "revoked" && !activeSpace)
		return { steps, next: null, state: "revoked", gaugeActive };

	if (requestStatus === "pending")
		return {
			steps,
			next: { key: "request", text: "Review their token request", needsAction: true, target: "token-requests", button: "Review request" },
			state: "in-progress",
			gaugeActive,
		};
	if (!pool)
		return {
			steps,
			next: { key: "pool", text: "Waiting for the partner to create their pool", needsAction: false, target: null, button: null },
			state: "in-progress",
			gaugeActive,
		};
	if (!hasGauge)
		return {
			steps,
			next: { key: "gauge", text: "Add their pool to a gauge", needsAction: true, target: "add-gauge", button: "Add gauge" },
			state: "in-progress",
			gaugeActive,
		};
	if (!activeSpace)
		return {
			steps,
			next: { key: "space", text: "Create their partner space and choose their wallets", needsAction: true, target: "partner-spaces", button: "Create space" },
			state: "in-progress",
			gaugeActive,
		};
	if (spacePoolOk === false)
		return {
			steps,
			next: {
				key: "spacepool",
				text: "Set the space's partner pool to the pool that has the gauge (Edit the space)",
				needsAction: true,
				target: "partner-spaces",
				button: "Edit space",
			},
			state: "in-progress",
			gaugeActive,
		};
	if (!activeSpace.linkSentAt)
		return {
			steps,
			next: { key: "link", text: "Send the partner their private link", needsAction: true, target: "partner-spaces", button: "Get link" },
			state: "in-progress",
			gaugeActive,
		};
	if (partnerVoterFlagged === false)
		return {
			steps,
			next: {
				key: "voter",
				text: "Flag the shared partner voter once: Controls, Partner voters, Fill in the shared partner voter. Every partner uses it.",
				needsAction: true,
				target: "controls",
				button: "Open Controls",
			},
			state: "in-progress",
			gaugeActive,
		};
	return { steps, next: null, state: "done", gaugeActive };
}

/** How many partners are waiting on the admin. */
export const countNeedingAction = (results: OnboardingResult[]): number =>
	results.filter((r) => r.next?.needsAction).length;
