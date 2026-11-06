export const ACCELERATOR_PARTNERS_STORE = "accelerator-partners";
export const ACCELERATOR_CONFIG_STORE = "accelerator-config";

export const ACCELERATOR_PARTNER_ADD_ACTION = "add accelerator partner";
export const ACCELERATOR_PARTNER_UPDATE_ACTION = "update accelerator partner";
export const ACCELERATOR_PARTNER_REMOVE_ACTION = "remove accelerator partner";
export const ACCELERATOR_CONFIG_SET_ACTION = "set accelerator wallet";

// docs.solve3.fi/more/accelerator-program: a project is matched for a
// maximum of 4 epochs.
export const ACCELERATOR_DEFAULT_MAX_EPOCHS = 4;
// "If your pool has earned 2% of all total Solve3 votes..."
export const ACCELERATOR_ELIGIBILITY_THRESHOLD_PCT = 2;
// "...up to a maximum of 10%..."
export const ACCELERATOR_MAX_MATCH_PCT = 10;

export type AcceleratorPartnerStatus = "active" | "completed" | "removed";

export type AcceleratorPartner = {
	poolAddress: string;
	projectName: string;
	enrolledAtEpoch: number;
	maxEpochs: number;
	status: AcceleratorPartnerStatus;
	notes?: string;
	addedBy: string;
	addedAt: number;
	updatedAt: number;
};

export type AcceleratorPartnersById = Record<string, AcceleratorPartner>;

export type AcceleratorConfig = {
	acceleratorWalletPubkey?: string;
	/** Defaults to on: the keeper enrols, expires and matches partners every epoch without admin clicks. */
	automatic?: boolean;
	/** Keeper release controls, preserved by the existing signed config endpoint. */
	activationEpoch?: number;
	veTokenId?: string;
	recyclingEnabled?: boolean;
	recyclingProgramdataSha256?: string;
	updatedBy?: string;
	updatedAt?: number;
};

/** Optional lock choice is signed when supplied; older callers keep their payload. */
export function acceleratorConfigPayload(input: {
	acceleratorWalletPubkey?: string;
	automatic?: boolean;
	veTokenId?: string;
}) {
	return {
		acceleratorWalletPubkey: input.acceleratorWalletPubkey ?? "",
		automatic: input.automatic ?? null,
		...(input.veTokenId !== undefined ? { veTokenId: input.veTokenId } : {}),
	};
}
